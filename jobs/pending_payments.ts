import { payRequest, isPendingPayment } from '../ln';
import { PendingPayment, Order, User, Community } from '../models';
import * as messages from '../bot/messages';
import { getUserI18nContext } from '../util';
import { logger } from '../logger';
import { Telegraf } from 'telegraf';
import { I18nContext } from '@grammyjs/i18n';
import { MainContext } from '../bot/start';

exports.attemptPendingPayments = async (bot: MainContext): Promise<void> => {
  const pendingPayments = await PendingPayment.find({
    paid: false,
    attempts: { $lt: process.env.PAYMENT_ATTEMPTS },
    is_invoice_expired: false,
    community_id: null,
  });
  for (const pending of pendingPayments) {
    const order = await Order.findOne({ _id: pending.order_id });
    if (!order) {
      logger.warning(
        `Order ${pending.order_id.toString()} of PendingPayment ${pending._id.toString()}`
      );
      continue;
    }
    try {
      pending.attempts++;
      if (order.status === 'SUCCESS') {
        pending.paid = true;
        await pending.save();
        logger.info(`Order id: ${order._id} was already paid`);
        return;
      }
      // We check if the old payment is on flight
      const isPendingOldPayment: boolean = await isPendingPayment(
        order.buyer_invoice
      );

      // We check if this new payment is on flight
      const isPending: boolean = await isPendingPayment(
        pending.payment_request
      );

      // If one of the payments is on flight we don't do anything
      if (isPending || isPendingOldPayment) return;

      let payment = await payRequest(order);
      const buyerUser = await User.findOne({ _id: order.buyer_id });
      const i18nCtx: I18nContext = await getUserI18nContext(
        buyerUser || { lang: 'en' }
      );
      // If the buyer's invoice is expired we let it know and don't try to pay again
      if (!!payment && payment.is_expired) {
        pending.is_invoice_expired = true;
        order.paid_hold_buyer_invoice_updated = false;
        if (buyerUser) {
          return await messages.expiredInvoiceOnPendingMessage(
            bot,
            buyerUser,
            order,
            i18nCtx
          );
        }
      }

      if (!!payment && !!payment.confirmed_at) {
        order.status = 'SUCCESS';
        order.routing_fee = payment.fee;
        pending.paid = true;
        pending.paid_at = new Date();
        if (buyerUser) {
          // We add a new completed trade for the buyer
          buyerUser.trades_completed++;
          await buyerUser.save();
        }
        // We add a new completed trade for the seller
        const sellerUser = await User.findOne({ _id: order.seller_id });
        if (sellerUser) {
          sellerUser.trades_completed++;
          sellerUser.save();
        }
        logger.info(`Invoice with hash: ${pending.hash} paid`);
        if (buyerUser) {
          await messages.toAdminChannelPendingPaymentSuccessMessage(
            bot,
            buyerUser,
            order,
            pending,
            payment,
            i18nCtx
          );
          await messages.toBuyerPendingPaymentSuccessMessage(
            bot,
            buyerUser,
            order,
            payment,
            i18nCtx
          );
          await messages.rateUserMessage(bot, buyerUser, order, i18nCtx);
        }
      } else {
        if (
          process.env.PAYMENT_ATTEMPTS !== undefined &&
          pending.attempts === parseInt(process.env.PAYMENT_ATTEMPTS)
        ) {
          order.paid_hold_buyer_invoice_updated = false;
          if (buyerUser) {
            await messages.toBuyerPendingPaymentFailedMessage(
              bot,
              buyerUser,
              order,
              i18nCtx
            );
          }
        }
        if (buyerUser) {
          await messages.toAdminChannelPendingPaymentFailedMessage(
            bot,
            buyerUser,
            order,
            pending,
            i18nCtx
          );
        }
      }
    } catch (error: any) {
      const message: string = error.toString();
      logger.error(`attemptPendingPayments catch error: ${message}`);
    } finally {
      await order.save();
      await pending.save();
    }
  }
};

exports.attemptCommunitiesPendingPayments = async (
  bot: Telegraf<MainContext>
): Promise<void> => {
  const pendingPayments = await PendingPayment.find({
    paid: false,
    attempts: { $lt: process.env.PAYMENT_ATTEMPTS },
    is_invoice_expired: false,
    community_id: { $ne: null },
  });

  for (const pending of pendingPayments) {
    try {
      pending.attempts++;

      // We check if this new payment is on flight
      const isPending: boolean = await isPendingPayment(
        pending.payment_request
      );

      // If the payments is on flight we don't do anything
      if (isPending) return;

      const order = await Order.findOne({ _id: pending.order_id });
      if (!order) {
        logger.warn(
          `Order ${pending.order_id.toString()} of PendingPayment ${pending._id.toString()}`
        );
        continue;
      }
      const payment = await payRequest(order);
      const user = await User.findById(pending.user_id);
      const i18nCtx: I18nContext = await getUserI18nContext(
        user || { lang: 'en' }
      );
      // If the buyer's invoice is expired we let it know and don't try to pay again
      if (!!payment && payment.is_expired) {
        pending.is_invoice_expired = true;
        if (user) {
          await bot.telegram.sendMessage(
            user.tg_id,
            i18nCtx.t('invoice_expired_earnings')
          );
        }
      }

      const community = await Community.findById(pending.community_id);
      if (!!payment && !!payment.confirmed_at) {
        pending.paid = true;
        pending.paid_at = new Date();

        if (community) {
          // Reset the community's values
          community.earnings = 0;
          community.orders_to_redeem = 0;
          await community.save();
          logger.info(
            `Community ${community._id} withdrew ${pending.amount} sats, invoice with hash: ${payment.id} was paid`
          );
          if (user) {
            await bot.telegram.sendMessage(
              user.tg_id,
              i18nCtx.t('pending_payment_success', {
                id: community._id,
                amount: pending.amount,
                paymentSecret: payment.secret,
              })
            );
          }
        }
      } else {
        if (
          process.env.PAYMENT_ATTEMPTS !== undefined &&
          pending.attempts === parseInt(process.env.PAYMENT_ATTEMPTS) &&
          user
        ) {
          await bot.telegram.sendMessage(
            user.tg_id,
            i18nCtx.t('pending_payment_failed', {
              attempts: pending.attempts,
            })
          );
        }
        logger.error(
          `Community ${community?.id}: Withdraw failed after ${pending.attempts} attempts, amount ${pending.amount} sats`
        );
      }
    } catch (error) {
      logger.error(`attemptCommunitiesPendingPayments catch error: ${error}`);
    } finally {
      await pending.save();
    }
  }
};
