const express = require('express');
const router = express.Router();
const { isValidSignature } = require('../webhooks');
const { TradesHandler } = require('../trading');
const Big = require('big.js');

const handlers = {
    'trade.started': async (payload, tradesHandler) => {
        await tradesHandler.markAsStarted(payload.trade_hash);
    },
    'trade.chat_message_received': async (payload, _, paxfulApi, ctx) => {
        const offerOwnerUsername = ctx.config.username;

        // We're reacting only to messages that are sent by buyer (i.e. offer taker)
        const allMessages = (await paxfulApi.invoke('/paxful/v1/trade-chat/get', {
            trade_hash: payload.trade_hash
        })).data.messages;
        const nonSystemMessages = allMessages.filter(m => 'msg' === m.type).reverse();
        const lastNonSystemMessage = nonSystemMessages.slice()[0];
        const isLastMessageByBuyer = lastNonSystemMessage.author !== offerOwnerUsername;
        if (!isLastMessageByBuyer) {
            return;
        }

        await paxfulApi.invoke('/paxful/v1/trade-chat/post', {
            trade_hash: payload.trade_hash,
            message: 'This is a fully automate trade, no human is monitoring chat. Please do not expect a reply.'
        });
    },
    'trade.paid': async (payload, tradesHandler) => {
        const tradeHash = payload.trade_hash;

        if (await tradesHandler.isFiatPaymentReceivedInFullAmount(tradeHash)) {
            await tradesHandler.markCompleted(tradeHash);
        }
    },
};

const validateFiatPaymentConfirmationRequestSignature = async (req) => {
    // TODO
    // In a real production application you would need to implement this method to
    // verify a request indeed came from a bank. That will help to avoid situations
    // when a someone may get to know what URL your application has for accepting
    // confirmations from bank and then by issuing requests to this endpoint will
    // pretend being a bank (which will result in releasing crypto without you
    // receiving a fiat payment first)
    return true;
}

// This method is to be called by a bank when a fiat transaction has been received
router.post('/bank/transaction-arrived', async(req, res) => {
    if (!(await validateFiatPaymentConfirmationRequestSignature(req))) {
        res.status(400);
        res.json({
            status: 'error',
            errors: ['Request authenticity (signature) validation failed.']
        });
        return;
    }

    const payload = req.body;

    if (!payload['reference'] || !payload['amount'] || !payload['currency']) {
        res.status(400);
        res.json({
            status: 'error',
            errors: ['"reference", "amount" or "currency" were not provided.']
        });
        return;
    }

    if (payload.balance < 0) {
        res.status(400);
        res.json({
            status: 'error',
            errors: ['"amount" cannot be negative ']
        });
        return;
    }

    const tradesHandler = new TradesHandler(req.context.services.paxfulApi);
    const tradeHash = await tradesHandler.findTradeHashByPaymentReference(payload.reference);
    if (tradeHash) {
        if (await tradesHandler.isCryptoReleased(tradeHash)) {
            res.status(400);
            res.json({
                status: 'error',
                errors: [`Crypto for a given trade has already been released.`]
            });
        } else {
            const tradeData = await tradesHandler.getFiatBalanceAndCurrency(tradeHash);
            if (tradeData.currency.toLowerCase() !== payload.currency.toLowerCase()) {
                res.status(400);
                res.json({
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
        res.status(404);
        res.json({
            status: 'error',
            errors: [`Unable to find a trade where sender account's prefix is ${payload.sender_account_number}`]
        });
    }
});

router.post('/paxful/webhook', async (req, res) => {
    res.set("X-Paxful-Request-Challenge", req.headers['x-paxful-request-challenge'])

    const isValidationRequest = req.body.type === undefined;
    if (isValidationRequest) {
        console.debug("Validation request arrived");

        res.json({"status": "ok"});
        return
    }

    const signature = req.get('x-paxful-signature');
    if (!signature) {
        console.warn("No signature");

        res.json({"status": "error", "message": "No signature header"});
        res.status(403);
        return;
    }

    if (!isValidSignature(signature, req.get('host'), req.originalUrl, req.rawBody)) {
        console.warn("Invalid signature");

        res.json({"status": "error", "message": "Invalid signature"});
        res.status(403);
        return;
    }

    console.debug("\n---------------------")
    console.debug("New incoming webhook:")
    console.debug(req.body)
    console.debug("---------------------")

    const type = req.body.type;
    if (handlers[type]) {
        try {
            const paxfulApi = req.context.services.paxfulApi;

            const tradesHandler = new TradesHandler(paxfulApi);
            await handlers[type](req.body.payload, tradesHandler, paxfulApi, req.context);
        } catch(e) {
            console.error(`Error when handling '${type}' webhook:`, e);
        }
    }

});

module.exports = router;