import { Dispute, Order, User } from '../models';
import * as messages from './messages';
// @ts-ignore
import disputeMessages from './modules/dispute/messages';

import { logger } from '../logger';
import { MainContext } from './start';
import {
  waitPayment,
  cancelShowHoldInvoice,
  cancelAddInvoice,
  // @ts-ignore
} from './commands';
import { Telegraf } from 'telegraf';
import { requestPayment, requestWalletAddress } from '../ln/extWallet';
import { ethers } from 'ethers';
import { safeSceneLeave } from './utils';
import { getUserI18nContext } from '../util';
import { UserDocument, UserReview2 } from '../models/user';

export const extWalletRequestPayment = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  orderId: string
) => {
  try {
    await ctx.deleteMessage().catch(() => {});
    await ctx.scene.leave();

    if (!orderId) return;
    const order = await Order.findOne({ _id: orderId });

    if (!order) return;
    const targetUser = await User.findOne({ _id: order.seller_id });
    if (!targetUser) {
      return;
    }
    const buyerUser = await User.findOne({ _id: order.buyer_id });
    if (!buyerUser) {
      return;
    }

    if (!(order.status === 'WAITING_PAYMENT')) {
      await messages.invalidDataMessage(ctx, bot, targetUser);
      return;
    }

    try {
      await requestPayment({
        telegramId: targetUser.tg_id,
        recipientTelegramID: buyerUser.tg_id,
        amount: order.amount.toString(),
        orderId: order._id.toString(),
      });
    } catch (e) {
      await messages.extWalletErrorMessage(
        ctx,
        bot,
        'sell',
        targetUser,
        e as Error
      );
      await cancelShowHoldInvoice(ctx, order, false);
      return;
    }
    await messages.extWalletPaymentRequestSentMessage(
      ctx,
      targetUser,
      ctx.i18n
    );
  } catch (error) {
    logger.error(error);
  }
};

export const extWalletRequestAddress = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  orderId: string
) => {
  try {
    await ctx.deleteMessage().catch(() => {});

    if (!orderId) return;
    const order = await Order.findOne({ _id: orderId });

    if (!order) return;
    const targetUser = await User.findOne({ _id: order.buyer_id });
    if (!targetUser) {
      return;
    }

    if (!(order.status === 'WAITING_BUYER_INVOICE')) {
      await messages.invalidDataMessage(ctx, bot, targetUser);
      return;
    }

    const msg = await messages.extWalletAddressRequestSentMessage(
      ctx,
      targetUser,
      ctx.i18n
    );
    try {
      await requestWalletAddress({
        ctx,
        telegramId: targetUser.tg_id,
        order,
        message: msg || ({} as any),
      });
    } catch (e) {
      msg?.message_id &&
        ctx.telegram
          .deleteMessage(ctx.chat?.id || order.buyer_id, msg.message_id)
          .catch(() => {});
      await messages.extWalletErrorMessage(
        ctx,
        bot,
        'buy',
        targetUser,
        e as Error
      );
      await cancelAddInvoice(ctx, order, false);
      return;
    }
  } catch (error) {
    logger.error(error);
  }
};

export const extWalletRequestAddressResponse = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  orderId: string,
  address: string
) => {
  try {
    if (!ethers.isAddress(address)) {
      return;
    }
    if (!orderId) {
      return;
    }
    const order = await Order.findOne({ _id: orderId });
    if (!order) {
      return;
    }

    const buyer = await User.findOne({ _id: order.buyer_id });
    const seller = await User.findOne({ _id: order.seller_id });
    if (!buyer || !seller) {
      return;
    }

    if (!(order.status === 'WAITING_BUYER_INVOICE')) {
      return;
    }

    await ctx.deleteMessage().catch(() => {});
    await safeSceneLeave(ctx);

    await messages.extWalletAddressReceivedMessage(
      ctx,
      buyer,
      address,
      ctx.i18n
    );

    buyer.lightning_address = address;
    await buyer.save();
    await waitPayment(ctx, bot, buyer, seller, order, address);
  } catch (error) {
    logger.error(error);
  }
};

export const disputeFromEscrow = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  orderId: string
) => {
  try {
    const order = await Order.findOne({ _id: orderId });
    if (!order || !['FIAT_SENT', 'ACTIVE'].includes(order.status)) {
      return;
    }
    const buyer = await User.findOne({ _id: order.buyer_id });
    const seller = await User.findOne({ _id: order.seller_id });
    if (!buyer || !seller) {
      return;
    }
    let initiator = 'buyer';

    (order as any)[`${initiator}_dispute`] = true;
    order.status = 'DISPUTE';
    await order.save();

    // If this is a non community order, we may ban the user globally
    if (order.community_id) {
      // We increment the number of disputes on both users
      // If a user disputes is equal to MAX_DISPUTES, we ban the user
      const buyerDisputes =
        (await Dispute.countDocuments({
          $or: [{ buyer_id: buyer._id }, { seller_id: buyer._id }],
        })) + 1;
      const sellerDisputes =
        (await Dispute.countDocuments({
          $or: [{ buyer_id: seller._id }, { seller_id: seller._id }],
        })) + 1;
      if (buyerDisputes >= parseInt(process.env.MAX_DISPUTES || '5', 10)) {
        buyer.banned = true;
        await buyer.save();
      }
      if (sellerDisputes >= parseInt(process.env.MAX_DISPUTES || '5', 10)) {
        seller.banned = true;
        await seller.save();
      }
    }

    const dispute = new Dispute({
      initiator,
      seller_id: seller._id,
      buyer_id: buyer._id,
      community_id: order.community_id,
      status: 'WAITING_FOR_SOLVER',
      order_id: order._id,
    });
    await dispute.save();
    // Send message to both users
    await disputeMessages.beginDispute(ctx, initiator, order, buyer, seller);
    // Show the dispute button to solvers
    await disputeMessages.takeDisputeButton(ctx, order);
    logger.warning(`Order ${order.id}: User ${seller.id} started a dispute!`);
  } catch (error) {
    logger.error(error);
  }
};

export const orderRefunded = async (
  bot: Telegraf<MainContext>,
  orderId: string
) => {
  try {
    const order = await Order.findOne({ _id: orderId });

    if (!order) {
      return;
    }

    if (!(order.status === 'ACTIVE' || order.status === 'FIAT_SENT')) {
      return;
    }

    const buyer = await User.findOne({ _id: order.buyer_id });
    if (!buyer) {
      return;
    }
    const seller = await User.findOne({ _id: order.seller_id });
    if (!seller) {
      return;
    }

    const i18nCtxBuyer = await getUserI18nContext(buyer);
    const i18nCtxSeller = await getUserI18nContext(seller);
    order.status = 'CANCELED';
    // We sent a private message to the users
    await messages.successCancelOrderMessage(bot, buyer, order, i18nCtxBuyer);
    await messages.counterPartyCancelOrderMessage(
      bot,
      seller,
      order,
      i18nCtxSeller
    );
    logger.info(`Order ${order._id} was cancelled cooperatively!`);
    await order.save();
  } catch (error) {
    logger.error(error);
  }
};

export const saveUserReview = async (
  targetUser: UserDocument,
  sourceUser: UserDocument,
  rating: number
) => {
  try {
    const reviews = await UserReview2.find({ target: targetUser._id });
    let review = reviews.find(x => x.source.toString().toLowerCase() === sourceUser._id.toString().toLowerCase());
    if (!review) {
      review = new UserReview2({
        source: sourceUser._id,
        target: targetUser._id,
        rating,
        reviewed_at: new Date(),
      });
      reviews.push(review);
    }
    const totalReviews = reviews.length;
    review.rating = rating;
    review.reviewed_at = new Date();
    await review.save();

    const newRating =
      reviews.map(x => x.rating).reduce((a, b) => a + b, 0) / totalReviews;
    targetUser.total_rating = newRating;
    targetUser.last_rating = targetUser.total_rating || 0;
    targetUser.total_reviews = totalReviews;

    await targetUser.save();
  } catch (error) {
    logger.error(error);
  }
};
