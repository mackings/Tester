const express = require('express');
const http = require('http');
const { isValidSignature } = require('../webhooks');
const { TradesHandler } = require('../trading');
const Big = require('big.js');
const router = express.Router();
const socketIo = require('socket.io');
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const dotenv = require('dotenv').config();
const admin = require("firebase-admin");
const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');


const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: privateKey,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
};



admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();


const allowedOrigins = [
  'https://b-backend-xe8q.onrender.com', // Your backend URL
  'http://localhost:3000', // If you're running your Flutter web app locally for development
  // Add any other origins where your Flutter app might be running
];

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});


const tradesChatMessages = {}; // In-memory store for trade chat messages
const tradeHashQueue = []; // Queue to store trade hashes in order of receipt

// Broadcast a message to all connected WebSocket clients
const broadcast = (message) => {
  io.sockets.emit('message', message);
  console.log('WebSocket sent data:', JSON.stringify(message)); // Log the data being sent
};

const saveTradeToFirestore = async (payload, collection) => {
  try {
    const docRef = db.collection(collection).doc(payload.trade_hash);
    await docRef.set({
      ...payload,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Trade ${payload.trade_hash} saved to Firestore.`);
  } catch (error) {
    console.error('Error saving trade to Firestore:', error);
  }
};

const saveChatMessageToFirestore = async (payload, messages) => {
  try {
    const docRef = db.collection('tradeMessages').doc(payload.trade_hash);
    await docRef.set({
      trade_hash: payload.trade_hash,
      messages: admin.firestore.FieldValue.arrayUnion(...messages),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`Chat messages for trade ${payload.trade_hash} saved to Firestore.`);
  } catch (error) {
    console.error('Error saving chat messages to Firestore:', error);
  }
};


const handlers = {


  'trade.started': async (payload, tradesHandler, paxfulApi) => {
    console.log('Handler trade.started called with payload:', payload); // Logging
    await tradesHandler.markAsStarted(payload.trade_hash);
    const response = await paxfulApi.invoke('/paxful/v1/trade/get', { trade_hash: payload.trade_hash });
    console.log(response);
    console.log('Trade started Invocation');
    broadcast({ event: 'trade.started', data: payload });
    await saveTradeToFirestore(payload, 'trades');
  },

  'trade.chat_message_received': async (payload, _, paxfulApi, ctx) => {
    console.log('Handler trade.chat_message_received called with payload:', payload); // Logging
    const offerOwnerUsername = ctx.config.username;
    const maxRetries = 5;
    let retries = 0;
    let messages;

    while (retries < maxRetries) {
      try {
        const response = await paxfulApi.invoke('/paxful/v1/trade-chat/get', { trade_hash: payload.trade_hash });
        if (response && response.data && response.data.messages) {
          messages = response.data.messages;
          break;
        }
        retries++;
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second before retrying
      } catch (error) {
        console.error('Error fetching trade chat messages:', error);
        throw error;
      }
    }

    if (!messages) {
      console.warn('Messages are not available after multiple retries.');
      return;
    }

    // Store messages in the in-memory store
    tradesChatMessages[payload.trade_hash] = messages;
    tradeHashQueue.push(payload.trade_hash); // Add trade hash to the queue

    const nonSystemMessages = messages.filter((m) => m.type === 'msg' || m.type === 'bank-account-instruction').reverse();
    const lastNonSystemMessage = nonSystemMessages[0];

    // Process bank account instruction messages differently
    if (lastNonSystemMessage.type === 'bank-account-instruction') {
      const bankAccountDetails = lastNonSystemMessage.text.bank_account;
      console.log('Received bank account details:', bankAccountDetails);
    } else {
      const isLastMessageByBuyer = lastNonSystemMessage.author !== offerOwnerUsername;
      if (!isLastMessageByBuyer) {
        return;
      }
    }
    broadcast({ event: 'trade.chat_message_received', data: payload });
    await saveChatMessageToFirestore(payload, messages);
  },



  'trade.paid': async (payload, tradesHandler) => {
    console.log('Handler trade.paid called with payload:', payload); // Logging
    const tradeHash = payload.trade_hash;
    if (await tradesHandler.isFiatPaymentReceivedInFullAmount(tradeHash)) {
      await tradesHandler.markCompleted(tradeHash);
      broadcast({ event: 'trade.paid', data: payload });
      await saveTradeToFirestore(payload, 'trades');
    }
  },
};

router.post('/paxful/webhook', async (req, res) => {
  res.set('X-Paxful-Request-Challenge', req.headers['x-paxful-request-challenge']);
  console.log('Webhook received with headers:', req.headers); // Logging

  const isValidationRequest = req.body.type === undefined;
  if (isValidationRequest) {
    console.debug('Validation request arrived');
    res.json({ status: 'ok' });
    return;
  }

  const signature = req.get('x-paxful-signature');
  if (!signature) {
    console.warn('No signature');
    res.status(403).json({ status: 'error', message: 'No signature header' });
    return;
  }

  if (!isValidSignature(signature, req.get('host'), req.originalUrl, req.rawBody)) {
    console.warn('Invalid signature');
    res.status(403).json({ status: 'error', message: 'Invalid signature' });
    return;
  }

  console.debug('\n---------------------');
  console.debug('New incoming webhook:');
  console.debug(req.body);
  console.debug('---------------------');

  const type = req.body.type;
  if (handlers[type]) {
    try {
      const paxfulApi = req.context.services.paxfulApi;
      const tradesHandler = new TradesHandler(paxfulApi);
      console.log(`Handler for ${type} found, invoking...`); // Logging
      await handlers[type](req.body.payload, tradesHandler, paxfulApi, req.context);
    } catch (e) {
      console.error(`Error when handling '${type}' event`);
      console.error(e);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
      return;
    }
  } else {
    console.warn('Unhandled webhook event:', req.body.type);
    res.status(204).json({ status: 'ignored', message: 'Unhandled event' });
    return;
  }

  res.status(200).json({ status: 'success' });
});

io.on('connection', (socket) => {
  console.log('New WebSocket connection established'); // Logging

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected'); // Logging
  });
});

server.listen(process.env.SPORT, () => {
  console.log('Socket port 3000');
});

module.exports = router;
