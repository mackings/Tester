const express = require('express');
const router = express.Router();
const { isValidSignature } = require('../webhooks');
const { TradesHandler } = require('../trading');
const Big = require('big.js');

const tradesChatMessages = {}; // In-memory store for trade chat messages
const tradeHashQueue = []; // Queue to store trade hashes in order of receipt


const handlers = {

    'trade.started': async (payload, tradesHandler) => {
        await tradesHandler.markAsStarted(payload.trade_hash);

        await paxfulApi.invoke('/paxful/v1/trade-chat/post', {
            trade_hash: payload.trade_hash,
            message: 'Hello Boss, please drop me your Account.'
        });
    },

'trade.chat_message_received': async (payload, _, paxfulApi, ctx) => {
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
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second before retrying
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

    const nonSystemMessages = messages.filter(m => m.type === 'msg' || m.type === 'bank-account-instruction').reverse();
    const lastNonSystemMessage = nonSystemMessages[0];

    // Process bank account instruction messages differently
    if (lastNonSystemMessage.type === 'bank-account-instruction') {
        const bankAccountDetails = lastNonSystemMessage.text.bank_account;
        console.log('Received bank account details:', bankAccountDetails);

        // You can process the bank account details here
        // For example, save them to a trade record or log them for further analysis
        
    } else {
        const isLastMessageByBuyer = lastNonSystemMessage.author !== offerOwnerUsername;

        if (!isLastMessageByBuyer) {
            return;
        }

        // Automated response can be commented out or removed based on requirements
        // await paxfulApi.invoke('/paxful/v1/trade-chat/post', {
        //     trade_hash: payload.trade_hash,
        //     message: 'Good Day Chief, Nice having a trade with you boss..'
        // });
    }
},


    'trade.bank_account_shared': async (payload, tradesHandler) => {
        // Handle the bank account shared event
        const tradeHash = payload.trade_hash;
        console.log(`Bank account shared for trade: ${tradeHash}`);
        // Add your logic here, e.g., save the bank account details to the trade
        const trade = await tradesHandler.getTrade(tradeHash);
        trade.bankAccountShared = true;
        await tradesHandler.updateTrade(tradeHash, () => trade);
    },

    // New event handler for 'trade.bank_account_selected'
    'trade.bank_account_selected': async (payload, tradesHandler) => {
        // Handle the bank account selected event
        const tradeHash = payload.trade_hash;
        console.log(`Bank account selected for trade: ${tradeHash}`);
        const selectedBankAccount = payload.selected_bank_account;
        const trade = await tradesHandler.getTrade(tradeHash);
        trade.selectedBankAccount = selectedBankAccount;
        await tradesHandler.updateTrade(tradeHash, () => trade);
    },


    'trade.paid': async (payload, tradesHandler) => {
        const tradeHash = payload.trade_hash;

        if (await tradesHandler.isFiatPaymentReceivedInFullAmount(tradeHash)) {
            await tradesHandler.markCompleted(tradeHash);
        }
    },
};


//Get Trades in Queue

router.get('/paxful/trade-chats', async (req, res) => {
    const tradeHash = tradeHashQueue.length > 0 ? tradeHashQueue[0] : null; // Get the oldest trade hash

    if (!tradeHash || !tradesChatMessages[tradeHash]) {
        res.status(404).json({ status: 'error', message: 'No messages found for the oldest trade.' });
        return;
    }

    res.json({ status: 'success', messages: tradesChatMessages[tradeHash] });
});


router.post('/paxful/send-message', async (req, res) => {
    const message = req.body.message;
    const paxfulApi = req.context.services.paxfulApi;
    const tradeHash = tradeHashQueue.length > 0 ? tradeHashQueue[0] : null; // Get the oldest trade hash

    if (!tradeHash || !message) {
        res.status(400).json({ status: 'error', message: 'Both trade hash and message are required.' });
        return;
    }

    try {
        await paxfulApi.invoke('/paxful/v1/trade-chat/post', {
            trade_hash: tradeHash,
            message
        });

        // Remove the processed trade hash from the queue
        tradeHashQueue.shift();

        res.json({ status: 'success', message: 'Message sent successfully.' });
    } catch (error) {
        console.error('Error sending chat message:', error);
        res.status(500).json({ status: 'error', message: 'Failed to send message.' });
    }
});


const validateFiatPaymentConfirmationRequestSignature = async (req) => {
    // TODO: Implement request signature validation to verify the request authenticity.
    return true;
};


// This method is to be called by a bank when a fiat transaction has been received

router.post('/bank/transaction-arrived', async (req, res) => {
    if (!(await validateFiatPaymentConfirmationRequestSignature(req))) {
        res.status(400).json({
            status: 'error',
            errors: ['Request authenticity (signature) validation failed.']
        });
        return;
    }

    const payload = req.body;

    if (!payload.reference || !payload.amount || !payload.currency) {
        res.status(400).json({
            status: 'error',
            errors: ['"reference", "amount" or "currency" were not provided.']
        });
        return;
    }

    if (payload.balance < 0) {
        res.status(400).json({
            status: 'error',
            errors: ['"amount" cannot be negative']
        });
        return;
    }

    const tradesHandler = new TradesHandler(req.context.services.paxfulApi);
    const tradeHash = await tradesHandler.findTradeHashByPaymentReference(payload.reference);
    if (tradeHash) {
        if (await tradesHandler.isCryptoReleased(tradeHash)) {
            res.status(400).json({
                status: 'error',
                errors: ['Crypto for a given trade has already been released.']
            });
        } else {
            const tradeData = await tradesHandler.getFiatBalanceAndCurrency(tradeHash);
            if (tradeData.currency.toLowerCase() !== payload.currency.toLowerCase()) {
                res.status(400).json({
                    status: 'error',
                    errors: [`Expected fiat currency is ${tradeData.currency.toLowerCase()}, instead given ${payload.currency.toLowerCase()}`]
                });

                return;
            }

            await tradesHandler.updateBalance(tradeHash, tradeData.balance.plus(new Big(payload.amount)));
            if (await tradesHandler.isFiatPaymentReceivedInFullAmount(tradeHash)) {
                await tradesHandler.markCompleted(tradeHash);
                res.json({ status: 'success' });
            } else {
                res.json({
                    status: 'success',
                    messages: [
                        `Balance updated, but amount is still less than expected, thus not released a trade ${tradeHash}.`
                    ]
                });
            }
        }
    } else {
        res.status(404).json({
            status: 'error',
            errors: [`Unable to find a trade where sender account's prefix is ${payload.sender_account_number}`]
        });
    }
});


//Verifications

router.post('/paxful/webhook', async (req, res) => {
    res.set("X-Paxful-Request-Challenge", req.headers['x-paxful-request-challenge']);

    const isValidationRequest = req.body.type === undefined;
    if (isValidationRequest) {
        console.debug("Validation request arrived");
        res.json({ status: "ok" });
        return;
    }

    const signature = req.get('x-paxful-signature');
    if (!signature) {
        console.warn("No signature");
        res.status(403).json({ status: "error", message: "No signature header" });
        return;
    }

    if (!isValidSignature(signature, req.get('host'), req.originalUrl, req.rawBody)) {
        console.warn("Invalid signature");
        res.status(403).json({ status: "error", message: "Invalid signature" });
        return;
    }

    console.debug("\n---------------------");
    console.debug("New incoming webhook:");
    console.debug(req.body);
    console.debug("---------------------");

    const type = req.body.type;
    if (handlers[type]) {
        try {
            const paxfulApi = req.context.services.paxfulApi;
            const tradesHandler = new TradesHandler(paxfulApi);
            await handlers[type](req.body.payload, tradesHandler, paxfulApi, req.context);
        } catch (e) {
            console.error(`Error when handling '${type}' webhook:`, e);
        }
    }
});

module.exports = router;
