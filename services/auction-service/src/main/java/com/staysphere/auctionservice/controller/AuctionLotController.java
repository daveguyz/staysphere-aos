package com.staysphere.auctionservice.controller;

import com.staysphere.auctionservice.model.*;
import com.staysphere.auctionservice.repository.BidRepository;
import com.staysphere.auctionservice.service.*;
import com.staysphere.shared.dto.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.*;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/auctions")
@RequiredArgsConstructor
public class AuctionLotController {

    private final AuctionLotService lotService;
    private final BidEngineService bidEngineService;
    private final DepositService depositService;
    private final BidRepository bidRepository;

    // ─── Lot CRUD ──────────────────────────────────────────────────────────

    @PostMapping
    public ResponseEntity<ApiResponse<AuctionLot>> createLot(
            @RequestBody AuctionLot lot,
            @RequestHeader("X-User-Id") String userId) {
        lot.setSellerId(userId);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(lotService.createLot(lot), "Lot created"));
    }

    @GetMapping("/{lotId}")
    public ResponseEntity<ApiResponse<AuctionLot>> getLot(@PathVariable String lotId) {
        return ResponseEntity.ok(ApiResponse.success(lotService.getLot(lotId)));
    }

    @PutMapping("/{lotId}")
    public ResponseEntity<ApiResponse<AuctionLot>> updateLot(
            @PathVariable String lotId,
            @RequestBody AuctionLot updates,
            @RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(ApiResponse.success(lotService.updateLot(lotId, updates, userId)));
    }

    @PostMapping("/{lotId}/publish")
    public ResponseEntity<ApiResponse<AuctionLot>> publishLot(
            @PathVariable String lotId,
            @RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(ApiResponse.success(lotService.publishLot(lotId, userId)));
    }

    @DeleteMapping("/{lotId}")
    public ResponseEntity<ApiResponse<Void>> cancelLot(
            @PathVariable String lotId,
            @RequestHeader("X-User-Id") String userId) {
        lotService.cancelLot(lotId, userId);
        return ResponseEntity.ok(ApiResponse.success(null, "Lot cancelled"));
    }

    // ─── Browse / search ───────────────────────────────────────────────────

    @GetMapping
    public ResponseEntity<ApiResponse<Page<AuctionLot>>> getLots(
            @RequestParam(defaultValue = "SCHEDULED,OPEN,EXTENDED") String statuses,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "24") int size) {
        List<AuctionLotStatus> statusList = List.of(statuses.split(","))
                .stream().map(AuctionLotStatus::valueOf).toList();
        Pageable pageable = PageRequest.of(page, size, Sort.by("startsAt").ascending());
        return ResponseEntity.ok(ApiResponse.success(lotService.getLotsByStatuses(statusList, pageable)));
    }

    @GetMapping("/live")
    public ResponseEntity<ApiResponse<List<AuctionLot>>> getLiveLots() {
        Pageable p = PageRequest.of(0, 50);
        Page<AuctionLot> live = lotService.getLotsByStatuses(
                List.of(AuctionLotStatus.OPEN, AuctionLotStatus.EXTENDED), p);
        return ResponseEntity.ok(ApiResponse.success(live.getContent()));
    }

    @GetMapping("/seller/me")
    public ResponseEntity<ApiResponse<Page<AuctionLot>>> getMyLots(
            @RequestHeader("X-User-Id") String userId,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "20") int size) {
        Pageable pageable = PageRequest.of(page, size);
        return ResponseEntity.ok(ApiResponse.success(lotService.getSellerLots(userId, pageable)));
    }

    // ─── Bidding ───────────────────────────────────────────────────────────

    @PostMapping("/{lotId}/bids")
    public ResponseEntity<ApiResponse<Bid>> placeBid(
            @PathVariable String lotId,
            @RequestBody PlaceBidRequest req,
            @RequestHeader("X-User-Id") String userId,
            @RequestHeader("X-User-Email") String userEmail,
            @RequestHeader(value = "X-Forwarded-For", required = false) String ip) {
        Bid bid = bidEngineService.placeBid(
                lotId, userId, userEmail,
                req.amount(), req.proxyCeiling(),
                ip, req.deviceFingerprint(), req.userAgent()
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.success(bid, "Bid placed"));
    }

    @GetMapping("/{lotId}/bids")
    public ResponseEntity<ApiResponse<Page<Bid>>> getBidHistory(
            @PathVariable String lotId,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "20") int size) {
        Pageable pageable = PageRequest.of(page, size);
        return ResponseEntity.ok(ApiResponse.success(
                bidRepository.findByAuctionLotIdOrderByPlacedAtDesc(lotId, pageable)));
    }

    // ─── Deposit ───────────────────────────────────────────────────────────

    @PostMapping("/{lotId}/deposit")
    public ResponseEntity<ApiResponse<BidderDeposit>> placeDeposit(
            @PathVariable String lotId,
            @RequestBody DepositRequest req,
            @RequestHeader("X-User-Id") String userId,
            @RequestHeader("X-User-Email") String userEmail) {
        BidderDeposit deposit = depositService.createDepositHold(
                lotId, userId, userEmail, req.stripePaymentMethodId());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(deposit, "Deposit held"));
    }

    @GetMapping("/{lotId}/deposit/status")
    public ResponseEntity<ApiResponse<Boolean>> getDepositStatus(
            @PathVariable String lotId,
            @RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(ApiResponse.success(
                depositService.hasBidderPaidDeposit(lotId, userId)));
    }

    // ─── Request records ───────────────────────────────────────────────────
    record PlaceBidRequest(java.math.BigDecimal amount, java.math.BigDecimal proxyCeiling,
                           String deviceFingerprint, String userAgent) {}
    record DepositRequest(String stripePaymentMethodId) {}
}
