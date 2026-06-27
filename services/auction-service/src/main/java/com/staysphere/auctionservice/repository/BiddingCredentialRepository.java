package com.staysphere.auctionservice.repository;

import com.staysphere.auctionservice.model.BiddingCredential;
import com.staysphere.auctionservice.model.CredentialStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface BiddingCredentialRepository extends JpaRepository<BiddingCredential, String> {

    /** Check whether a bidder has an ACTIVE credential for a lot (quick gate check). */
    boolean existsByLotIdAndBidderIdAndStatus(
            String lotId, String bidderId, CredentialStatus status);

    /** Find ACTIVE credential for a bidder on a lot (for validation). */
    Optional<BiddingCredential> findByLotIdAndBidderIdAndStatus(
            String lotId, String bidderId, CredentialStatus status);

    /** Find by token hash — used in validateToken() lookup. */
    Optional<BiddingCredential> findByTokenHash(String tokenHash);

    /** All credentials for a lot — used by auctioneer dashboard Bidders tab. */
    List<BiddingCredential> findByLotIdOrderByIssuedAtDesc(String lotId);

    /** All ACTIVE credentials for a lot — used by revoke dropdown population. */
    List<BiddingCredential> findByLotIdAndStatus(String lotId, CredentialStatus status);

    /** Does a credential exist for this deposit? Prevents duplicate issuance. */
    boolean existsByDepositId(String depositId);

    /**
     * Bulk-expire all ACTIVE credentials for a lot when it closes.
     * Called by AuctionSettlementService after settlement.
     */
    @Modifying
    @Query("""
            UPDATE BiddingCredential c
               SET c.status = 'EXPIRED'
             WHERE c.lotId = :lotId
               AND c.status = 'ACTIVE'
            """)
    int expireAllForLot(@Param("lotId") String lotId);

    /**
     * Daily cleanup — expire credentials whose expiresAt has passed.
     */
    @Modifying
    @Query("""
            UPDATE BiddingCredential c
               SET c.status = 'EXPIRED'
             WHERE c.status = 'ACTIVE'
               AND c.expiresAt < :now
            """)
    int expireStale(@Param("now") LocalDateTime now);
}
