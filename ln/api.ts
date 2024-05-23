/* eslint-disable @typescript-eslint/no-misused-promises */
import express from 'express';
import bodyParser from 'body-parser';
import { ethers } from 'ethers';
import { logger } from '../logger';
import { Order, User } from '../models';
import { Telegraf } from 'telegraf';
import { MainContext } from '../bot/start';
import { decryptWalletRequestToken } from './extWallet';
import { getTokenSymbol } from './evm';
import { getStars, getUserAge } from '../util';

const app = express();
// app.set('trust proxy', 1);
app.use(bodyParser.json({}));
let bot: Telegraf<MainContext>;
app.post('/:token', (req, res) => {
  res.json({ msg: 'It works!' });
  (async () => {
    if (!bot) {
      return;
    }
    const update = await decryptWalletRequestToken(req.params.token);
    if (!update) {
      return;
    }
    const walletAddress = req.body?.walletAddress;
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return;
    }
    const order = await Order.findById(update.id);
    if (!order) {
      return;
    }
    update.data = `extWalletRequestAddressResponse(${order._id},${walletAddress})`;
    await bot.handleUpdate({
      ...{ __synthesized: true },
      update_id: 1,
      callback_query: update,
    });
  })().catch(e =>
    logger.error(`Error when handling callback: ${e?.toString()} ${e?.stack}`)
  );
});

app.get('/api/order/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const creator = await User.findById(order.creator_id);
    if (!creator) {
      return res.status(404).json({ error: 'Creator not found' });
    }
    const totalRating = creator.total_rating;
    const totalReviews = creator.total_reviews;
    return res.json({
      tokenSymbol: getTokenSymbol(),
      creator: creator.username,
      orderType: order.type,
      orderAmount: order.amount,
      fiatAmount: order.fiat_amount,
      fiatCode: order.fiat_code,
      paymentMethod: order.payment_method,
      status: order.status,
      trades: creator.trades_completed,
      volume: creator.volume_traded,
      daysBot: getUserAge(creator),
      daysWallet: getUserAge(creator, creator.extwallet_created_at),
      botHandle: bot.botInfo?.username,
      rating: totalReviews ? getStars(totalRating, totalReviews) : 'N/A',
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export function startApiServer(botInstance: Telegraf<MainContext>) {
  bot = botInstance;
  const port = parseInt(process.env.PORT || '') || 3000;
  const host = process.env.HOST || '0.0.0.0';

  app.listen(port, host, function () {
    logger.info(`API server listening on ${host}:${port}`);
  });
}
