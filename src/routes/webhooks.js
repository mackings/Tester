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
const serviceAccount = require('../../bkey.json');

 const serviceAccount =  {

  type: "service_account",
  project_id: "bibuain-de956",
  private_key_id: "ed612295c1918ba3170ed3defbbc192b999e7440",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDCouGYxl3XiUCr\nRob4ycajH/bTxi2rnXbtemYXHJkNrrixDnTIcsgDj3reffraolIP+789+Upn+BFS\nEMKTPXrkkzhtQ59ShZXu4KpCNxCIceKYZys2ZM5dIQ3OePw/62UHYFIOzA4KIxsZ\nGHFhDIrHylcovqHZfLqkYAYvdMQKyV+3aE457lePQA7jpl61Q2RuLt2P4J9tGfrL\nItBMGSMy2I1Gr+A9vB5kfOVZWjo9RfURtzj6vRvp9T5gZnznEjIIkVaQ9Ebwi+yT\nP+k6DRXed1TZXTYsOLHEvabcJTbiXepzW5Pdr68R2nlcSh0aYhlhcyPhWrBCPsKD\nbdxqMoDJAgMBAAECggEAEVaNHhzdkyuo1RkNQPBIf5ODW04WF2mJhJIYsgpcH/nm\nfe85u/ltk9OeMF+sjvlSshXM7WpdlHFmqZbQnmkln2L17dXORX2c45Cj2g4prN3o\nP4dBNDE6qNUe87uXTOJdN5D+/k5zGbgS2+NvhiOl4TJHHVwN8t/HiIj9RBD0vbkW\nttE+2Q3FSuJwetMmLoFyky4Mipvul2C1oEGvDkjhWdmjk973lqtorlgberZ3RwYh\npH4tktRhrc/FmpA9xgX+T8ek1kMejWncRNeVe8W7AMFtps9ys8VJToXrf9AqbOZ3\n1mF3o1KtSXoH0wh7cydfJ7AbXoBfcj8nx27mcXL9AQKBgQDsFQYalyI0I3OiTi2c\nVena9Q9Wvb3t7a7wFklT4LIs9R290LyJ0j+070y8a1EqwjTfXTilnneg2TwtnyCF\n3LPI/wQK32Lf7wphdNxvj26cIvh5lQezrWaerC7X5lfThP+3V79Rx8d2ku8HYick\nrRrqitos/MILfPjbrq5+xWg4+QKBgQDTDrJJosUx3PHmhVnYIzP0FyIrfrX6lUlS\nDYu5out+laaTlQ+DbTI+whFL+XBffJVlktM0VfV5kODoT1sshtO9ana6ukCYAe0q\ntEbIXNzMEAVI4g91MvWiUgk9CXZKUreI7h+4tfK31M8l+yzyeqkLRdXIYnV6S8fJ\nP/n0pmTKUQKBgQCMgp7VaKpk2czTBzDCYagEN+LfP6MxX0vFfZ47G/swItuGxBvS\n854TNHI5mq3+gwQxBSzX9g9BXsogZRtYUNl4gb+IMRiKK53ED2e7xmSQ7Ydx5a9l\n04jGW7itq10OeZQxLTqjlAI1opI9lL+zZowkmGvuZqmfaMw9BCS7MwcrEQKBgQC2\nrqPXZNI2xL2FAKuxj1bq0hM7fqPZT9p08VCdz8zydmoGmCEjayLwe14pWrDPlbBi\niOHTDQw6uxJRQk7yjYk9DKfUHF7Is/Iq4nvZ9bcP0lYgrbsfgIpog4WHlWcUEeDW\n3vYKFUMPp13dzDktcMpc/Yd7uO1ie7FkGsIp5tSa4QKBgB1cHBmivyV4/Zs6sMYS\nZGfr/rH0u2nWeO68v9gKF47yYi/BU7/P+NMLkvvTGk+rXVleES28DncqB2xzS98C\nQ9dq1W74XG1RfpKrB5WdqL0X27vBuc0lzGTxSc4EJHtMLc8FXDgP2v5aaBhqqSLB\nxSiIqpQRXIk/ubFSYDz7yNlh\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk-yjghu@bibuain-de956.iam.gserviceaccount.com",
  client_id: "113168733265613919459",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-yjghu%40bibuain-de956.iam.gserviceaccount.com",
  universe_domain: "googleapis.com"
}


//{
//   type: "service_account",
//   project_id: process.env.FIREBASE_PROJECT_ID,
//   private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
//   private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
//   client_email: process.env.FIREBASE_CLIENT_EMAIL,
//   client_id: process.env.FIREBASE_CLIENT_ID,
//   auth_uri: process.env.FIREBASE_AUTH_URI,
//   token_uri: process.env.FIREBASE_TOKEN_URI,
//   auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
//   client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
//   universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN

// };


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
    await docRef.set(payload);
    console.log(`Trade ${payload.trade_hash} saved to Firestore..`);
  } catch (error) {
    console.error('Error saving trade to Firestore:', error);
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
    await saveTradeToFirestore(payload, 'tradeMessages');
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
