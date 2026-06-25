package com.staysphere.auctionservice.service;

import com.staysphere.auctionservice.model.AuctionLot;
import com.staysphere.auctionservice.repository.AuctionLotRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service @Slf4j @RequiredArgsConstructor
public class AuctionSchedulerService {

    private final AuctionLotRepository lotRepository;
    private final AuctionLotService lotService;

    /** Every 10 seconds: open any lots whose startsAt has passed. */
    @Scheduled(fixedRate = 10_000)
    public void openScheduledLots() {
        List<AuctionLot> ready = lotRepository.findLotsReadyToOpen(LocalDateTime.now());
        for (AuctionLot lot : ready) {
            try {
                lotService.openLot(lot.getId());
                log.info("[Scheduler] Opened lot {}", lot.getId());
            } catch (Exception e) {
                log.error("[Scheduler] Failed to open lot {}: {}", lot.getId(), e.getMessage());
            }
        }
    }

    /** Every 10 seconds: close any lots whose scheduledEndsAt has passed. */
    @Scheduled(fixedRate = 10_000)
    public void closeExpiredLots() {
        List<AuctionLot> expired = lotRepository.findLotsReadyToClose(LocalDateTime.now());
        for (AuctionLot lot : expired) {
            try {
                lotService.closeLot(lot.getId());
                log.info("[Scheduler] Closed lot {}", lot.getId());
            } catch (Exception e) {
                log.error("[Scheduler] Failed to close lot {}: {}", lot.getId(), e.getMessage());
            }
        }
    }

    /** Every hour: send 1-hour reminder notifications for upcoming lots. */
    @Scheduled(fixedRate = 3_600_000)
    public void sendStartingReminders() {
        LocalDateTime from = LocalDateTime.now().plusMinutes(55);
        LocalDateTime until = LocalDateTime.now().plusMinutes(65);
        List<AuctionLot> soon = lotRepository.findLotsStartingSoon(from, until);
        soon.forEach(lot -> log.info("[Scheduler] Reminder — lot {} starts within 1 hour", lot.getId()));
        // Phase B: wire to notification-service via Kafka
    }
}
