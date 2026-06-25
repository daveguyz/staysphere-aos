package com.staysphere.auctionservice.repository;

import com.staysphere.auctionservice.model.BidderDeposit;
import com.staysphere.auctionservice.model.DepositStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface BidderDepositRepository extends JpaRepository<BidderDeposit, String> {

    Optional<BidderDeposit> findByAuctionLotIdAndBidderId(String lotId, String bidderId);

    Optional<BidderDeposit> findByStripePaymentIntentId(String paymentIntentId);

    List<BidderDeposit> findByAuctionLotIdAndStatus(String lotId, DepositStatus status);

    List<BidderDeposit> findByBidderIdOrderByCreatedAtDesc(String bidderId);

    boolean existsByAuctionLotIdAndBidderIdAndStatus(String lotId, String bidderId, DepositStatus status);
}
