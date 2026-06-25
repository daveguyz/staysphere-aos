package com.staysphere.auctionservice.service;

import com.staysphere.auctionservice.model.*;
import com.staysphere.auctionservice.repository.*;
import com.stripe.Stripe;
import com.stripe.model.PaymentIntent;
import com.stripe.param.PaymentIntentCaptureParams;
import com.stripe.param.PaymentIntentCreateParams;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Service @Slf4j @RequiredArgsConstructor
public class DepositService {

    private final BidderDepositRepository depositRepository;
    private final AuctionLotRepository lotRepository;

    @Value("${stripe.secret-key}") private String stripeSecretKey;

    /**
     * Create a Stripe PaymentIntent in manual capture mode (authorise only, don't charge yet).
     * The hold is released if the bidder loses, or captured if they win.
     */
    @Transactional
    public BidderDeposit createDepositHold(String lotId, String bidderId, String bidderEmail,
                                           String stripePaymentMethodId) {
        AuctionLot lot = lotRepository.findById(lotId)
                .orElseThrow(() -> new IllegalArgumentException("Lot not found: " + lotId));

        if (!Boolean.TRUE.equals(lot.getDepositRequired()))
            throw new IllegalStateException("This lot does not require a deposit");

        // Prevent duplicate deposits
        if (depositRepository.existsByAuctionLotIdAndBidderIdAndStatus(lotId, bidderId, DepositStatus.HELD))
            throw new IllegalStateException("You already have an active deposit for this lot");

        Stripe.apiKey = stripeSecretKey;
        BigDecimal amount = lot.getDepositAmount();
        long amountCents = amount.multiply(BigDecimal.valueOf(100)).longValue();

        try {
            PaymentIntent intent = PaymentIntent.create(
                    PaymentIntentCreateParams.builder()
                            .setAmount(amountCents)
                            .setCurrency(lot.getCurrency().toLowerCase())
                            .setPaymentMethod(stripePaymentMethodId)
                            .setCaptureMethod(PaymentIntentCreateParams.CaptureMethod.MANUAL)
                            .setConfirm(true)
                            .setDescription("Auction deposit: lot " + lotId)
                            .putMetadata("lot_id", lotId)
                            .putMetadata("bidder_id", bidderId)
                            .build()
            );

            BidderDeposit deposit = BidderDeposit.builder()
                    .auctionLotId(lotId)
                    .bidderId(bidderId)
                    .bidderEmail(bidderEmail)
                    .stripePaymentIntentId(intent.getId())
                    .depositAmount(amount)
                    .currency(lot.getCurrency())
                    .status(DepositStatus.HELD)
                    .authorisedAt(LocalDateTime.now())
                    .build();

            BidderDeposit saved = depositRepository.save(deposit);
            log.info("[Deposit] Hold created for bidder {} on lot {} PI={}", bidderId, lotId, intent.getId());
            return saved;

        } catch (Exception e) {
            BidderDeposit failedDeposit = BidderDeposit.builder()
                    .auctionLotId(lotId).bidderId(bidderId).bidderEmail(bidderEmail)
                    .stripePaymentIntentId("failed").depositAmount(amount)
                    .currency(lot.getCurrency()).status(DepositStatus.FAILED).build();
            depositRepository.save(failedDeposit);
            throw new IllegalStateException("Deposit authorisation failed: " + e.getMessage(), e);
        }
    }

    /** Release (cancel) all held deposits for losers when a lot closes. */
    @Transactional
    public void releaseLoserDeposits(String lotId, String winnerId) {
        List<BidderDeposit> held = depositRepository.findByAuctionLotIdAndStatus(lotId, DepositStatus.HELD);
        Stripe.apiKey = stripeSecretKey;

        for (BidderDeposit deposit : held) {
            if (deposit.getBidderId().equals(winnerId)) continue; // winner's deposit is captured separately
            try {
                PaymentIntent intent = PaymentIntent.retrieve(deposit.getStripePaymentIntentId());
                intent.cancel();
                deposit.setStatus(DepositStatus.RELEASED);
                deposit.setReleaseReason("LOST");
                deposit.setReleasedAt(LocalDateTime.now());
                depositRepository.save(deposit);
                log.info("[Deposit] Released deposit {} for loser {}", deposit.getId(), deposit.getBidderId());
            } catch (Exception e) {
                log.error("[Deposit] Failed to release deposit {}: {}", deposit.getId(), e.getMessage());
            }
        }
    }

    /** Capture (charge) the winner's deposit. */
    @Transactional
    public void captureWinnerDeposit(String lotId, String winnerId) {
        depositRepository.findByAuctionLotIdAndBidderId(lotId, winnerId).ifPresent(deposit -> {
            if (deposit.getStatus() != DepositStatus.HELD) return;
            Stripe.apiKey = stripeSecretKey;
            try {
                PaymentIntent intent = PaymentIntent.retrieve(deposit.getStripePaymentIntentId());
                intent.capture(PaymentIntentCaptureParams.builder().build());
                deposit.setStatus(DepositStatus.CHARGED);
                deposit.setStripeChargeId(intent.getLatestCharge());
                deposit.setChargedAt(LocalDateTime.now());
                depositRepository.save(deposit);
                log.info("[Deposit] Captured winner deposit for lot {} bidder {}", lotId, winnerId);
            } catch (Exception e) {
                log.error("[Deposit] Failed to capture winner deposit: {}", e.getMessage());
            }
        });
    }

    public boolean hasBidderPaidDeposit(String lotId, String bidderId) {
        return depositRepository.existsByAuctionLotIdAndBidderIdAndStatus(
                lotId, bidderId, DepositStatus.HELD);
    }
}
