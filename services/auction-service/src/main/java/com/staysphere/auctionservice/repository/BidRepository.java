package com.staysphere.auctionservice.repository;

import com.staysphere.auctionservice.model.Bid;
import com.staysphere.auctionservice.model.BidStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface BidRepository extends JpaRepository<Bid, String> {

    // Ordered bid history for a lot (most recent first)
    List<Bid> findByAuctionLotIdOrderByPlacedAtDesc(String auctionLotId);

    Page<Bid> findByAuctionLotIdOrderByPlacedAtDesc(String auctionLotId, Pageable pageable);

    // The current winning bid for a lot (highest active bid)
    @Query("SELECT b FROM Bid b WHERE b.auctionLotId = :lotId AND b.status IN ('ACTIVE','WINNING') ORDER BY b.amount DESC")
    Optional<Bid> findWinningBid(@Param("lotId") String lotId);

    // Highest bid for a lot regardless of status
    @Query("SELECT b FROM Bid b WHERE b.auctionLotId = :lotId ORDER BY b.amount DESC")
    List<Bid> findTopBidsByLot(@Param("lotId") String lotId, Pageable pageable);

    // A bidder's active bids across all lots
    List<Bid> findByBidderIdAndStatusOrderByPlacedAtDesc(String bidderId, BidStatus status);

    // All bids by a bidder on a specific lot
    List<Bid> findByAuctionLotIdAndBidderIdOrderByPlacedAtDesc(String lotId, String bidderId);

    // The highest proxy ceiling bid (for proxy resolution)
    @Query("SELECT b FROM Bid b WHERE b.auctionLotId = :lotId AND b.proxyCeiling IS NOT NULL AND b.status IN ('ACTIVE','WINNING') ORDER BY b.proxyCeiling DESC")
    List<Bid> findProxyBidsForLot(@Param("lotId") String lotId);

    // Unique bidder count on a lot
    @Query("SELECT COUNT(DISTINCT b.bidderId) FROM Bid b WHERE b.auctionLotId = :lotId")
    long countUniqueBidders(@Param("lotId") String lotId);

    // Total bid count on a lot
    long countByAuctionLotId(String lotId);

    // Bids placed in last N seconds on a lot (fraud velocity check)
    @Query("SELECT b FROM Bid b WHERE b.bidderId = :bidderId AND b.placedAt >= :since")
    List<Bid> findRecentBidsByBidder(@Param("bidderId") String bidderId, @Param("since") LocalDateTime since);

    // All bids on a lot above a threshold (sealed bid reveal)
    @Query("SELECT b FROM Bid b WHERE b.auctionLotId = :lotId ORDER BY b.amount DESC")
    List<Bid> findAllBidsForLotOrdered(@Param("lotId") String lotId);

    // Next valid bid sequence number for a lot
    @Query("SELECT COALESCE(MAX(b.bidSequence), 0) + 1 FROM Bid b WHERE b.auctionLotId = :lotId")
    long nextBidSequence(@Param("lotId") String lotId);

    boolean existsByAuctionLotIdAndBidderIdAndStatus(String lotId, String bidderId, BidStatus status);
}
