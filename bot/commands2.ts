import { Order, User } from '../models';
import * as messages from './messages';

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
import { SceneContext } from 'telegraf/scenes';

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

    if (!(order.status === 'WAITING_PAYMENT')) {
      await messages.invalidDataMessage(ctx, bot, targetUser);
      return;
    }

    try {
      await requestPayment({
        telegramId: targetUser.tg_id,
        recipientAddress: order.hash,
        amount: order.amount.toString(),
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

    await waitPayment(ctx, bot, buyer, seller, order, address);
  } catch (error) {
    logger.error(error);
  }
};
export async function safeSceneLeave(ctx: MainContext) {
  if (ctx.scene) {
    await ctx.scene.leave();
  } else if ((ctx as unknown as SceneContext).session?.__scenes) {
    (ctx as unknown as SceneContext).session.__scenes = {};
  }
}

