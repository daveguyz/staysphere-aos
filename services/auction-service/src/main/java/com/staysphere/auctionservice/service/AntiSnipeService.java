package com.staysphere.auctionservice.service;

import com.staysphere.auctionservice.model.AuctionLot;
import com.staysphere.auctionservice.model.AuctionLotStatus;
import com.staysphere.auctionservice.repository.AuctionLotRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service @Slf4j @RequiredArgsConstructor
public class AntiSnipeService {

    private final AuctionLotRepository lotRepository;

    /**
     * Checks whether a bid placed with msRemaining left should trigger
     * an anti-snipe extension. Mutates the lot's scheduledEndsAt in-place
     * (caller is responsible for persisting the lot).
     *
     * @return true if an extension was applied
     */
    public boolean checkAndExtend(AuctionLot lot, long msRemainingAtBid) {
        if (!Boolean.TRUE.equals(lot.getAntiSnipeEnabled())) return false;
        if (lot.getStatus() != AuctionLotStatus.OPEN && lot.getStatus() != AuctionLotStatus.EXTENDED) return false;
        if (lot.getAntiSnipeExtensionCount() >= lot.getMaxAntiSnipeExtensions()) return false;

        long triggerMs = lot.getAntiSnipeTriggerSeconds() * 1000L;
        if (msRemainingAtBid > triggerMs) return false;

        // Extend
        int extensionSecs = lot.getAntiSnipeExtensionSeconds();
        lot.setScheduledEndsAt(lot.getScheduledEndsAt().plusSeconds(extensionSecs));
        lot.setStatus(AuctionLotStatus.EXTENDED);
        lot.setAntiSnipeExtensionCount(lot.getAntiSnipeExtensionCount() + 1);

        log.info("[AntiSnipe] Lot {} extended by {}s (extension #{}/{}) — new end: {}",
                lot.getId(), extensionSecs,
                lot.getAntiSnipeExtensionCount(), lot.getMaxAntiSnipeExtensions(),
                lot.getScheduledEndsAt());
        return true;
    }
}
