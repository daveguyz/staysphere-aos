package com.staysphere.auctionservice.controller;

import com.staysphere.auctionservice.model.BiddingCredential;
import com.staysphere.auctionservice.service.AuctioneerAssignmentService;
import com.staysphere.auctionservice.service.BiddingCredentialService;
import com.staysphere.shared.dto.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST endpoints for bidding credentials.
 *
 * Bidder endpoints:
 *   GET  /api/v1/auctions/{lotId}/credential/status
 *     → credential status for the authenticated bidder on this lot.
 *     Polled by plugin-auction-room.js every 3s while status is PENDING.
 *
 * Auctioneer / seller endpoints:
 *   GET  /api/v1/auctions/{lotId}/credentials
 *     → all credentials for this lot (Bidders tab in dashboard)
 *   POST /api/v1/auctions/{lotId}/credentials/{credentialId}/revoke
 *     → revoke a credential mid-auction (Rule 11.3)
 *
 * Note: credential issuance (POST) is NOT exposed here. Credentials are
 * issued internally by DepositService after a deposit hold is confirmed.
 * This keeps the issuance flow atomic and prevents bypassing the deposit gate.
 */
@RestController
@RequiredArgsConstructor
public class BiddingCredentialController {

    private final BiddingCredentialService credentialService;
    private final AuctioneerAssignmentService assignmentService;

    // ── Bidder: check my credential status ───────────────────────────────

    /**
     * Poll endpoint — returns the current credential status for the authenticated bidder.
     * Used by plugin-auction-room.js to determine which bid panel state to show.
     *
     * Response: { credentialId, status, expiresAt, bidCountUsed }
     * status: "ACTIVE" | "REVOKED" | "EXPIRED" | null (not yet issued)
     */
    @GetMapping("/api/v1/auctions/{lotId}/credential/status")
    public ResponseEntity<ApiResponse<BiddingCredentialService.CredentialStatusView>> getMyStatus(
            @PathVariable String lotId,
            @RequestHeader("X-User-Id") String bidderId) {

        return ResponseEntity.ok(ApiResponse.success(
                credentialService.getStatus(lotId, bidderId)));
    }

    // ── Auctioneer / seller: manage credentials ───────────────────────────

    /**
     * All credentials for a lot, ordered by issuance time descending.
     * Renders the Bidders tab in the auctioneer dashboard.
     * Caller must be the auctioneer or seller of the lot.
     */
    @GetMapping("/api/v1/auctions/{lotId}/credentials")
    public ResponseEntity<ApiResponse<List<BiddingCredential>>> getCredentials(
            @PathVariable String lotId,
            @RequestHeader("X-User-Id") String callerId) {

        assertAuctioneerOrSeller(lotId, callerId);
        return ResponseEntity.ok(ApiResponse.success(
                credentialService.getCredentialsForLot(lotId)));
    }

    /**
     * Revoke a bidder's credential mid-auction.
     * Body: { "reason": "Bidder violated auction rules — Rule 12.1" }
     * Reason is required and included in the bidder notification email.
     */
    @PostMapping("/api/v1/auctions/{lotId}/credentials/{credentialId}/revoke")
    public ResponseEntity<ApiResponse<BiddingCredential>> revokeCredential(
            @PathVariable String lotId,
            @PathVariable String credentialId,
            @RequestBody Map<String, String> body,
            @RequestHeader("X-User-Id") String callerId) {

        assertAuctioneerOrSeller(lotId, callerId);

        String reason = body != null ? body.getOrDefault("reason", "") : "";
        if (reason.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("A reason for revocation is required"));
        }

        BiddingCredential revoked = credentialService.revokeCredential(
                credentialId, callerId, reason);

        return ResponseEntity.ok(ApiResponse.success(revoked,
                "Credential revoked — bidder has been notified"));
    }

    // ── Helper ────────────────────────────────────────────────────────────

    private void assertAuctioneerOrSeller(String lotId, String callerId) {
        if (!assignmentService.isAuctioneerOrSeller(lotId, callerId)) {
            throw new SecurityException(
                    "Only the auctioneer or seller may manage credentials for lot " + lotId);
        }
    }
}
