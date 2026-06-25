package com.staysphere.auctionservice.service;

import com.staysphere.auctionservice.model.AuctionRoomPresence;
import com.staysphere.auctionservice.repository.AuctionRoomPresenceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;

@Service @Slf4j @RequiredArgsConstructor
public class AuctionPresenceService {

    private final AuctionRoomPresenceRepository presenceRepository;
    private final StringRedisTemplate redis;

    private static final String PRESENCE_KEY   = "auction:presence:lot:%s";
    private static final String SESSION_LOT_KEY = "auction:session:%s:lot";
    private static final Duration SESSION_TTL   = Duration.ofHours(4);

    public void userJoined(String lotId, String sessionId, String userId, String userEmail, String ip) {
        // Redis set add (fast viewer count)
        redis.opsForSet().add(String.format(PRESENCE_KEY, lotId), sessionId);
        redis.opsForValue().set(String.format(SESSION_LOT_KEY, sessionId), lotId, SESSION_TTL);

        // Persist for audit
        presenceRepository.save(AuctionRoomPresence.builder()
                .auctionLotId(lotId).sessionId(sessionId)
                .userId(userId).userEmail(userEmail).ipAddress(ip)
                .isActive(true).build());
    }

    public void userLeft(String sessionId) {
        String lotId = redis.opsForValue().get(String.format(SESSION_LOT_KEY, sessionId));
        if (lotId == null) return;

        redis.opsForSet().remove(String.format(PRESENCE_KEY, lotId), sessionId);
        redis.delete(String.format(SESSION_LOT_KEY, sessionId));

        presenceRepository.findBySessionIdAndIsActiveTrue(sessionId).ifPresent(p -> {
            p.setIsActive(false);
            p.setLeftAt(LocalDateTime.now());
            presenceRepository.save(p);
        });
    }

    public long getViewerCount(String lotId) {
        Long count = redis.opsForSet().size(String.format(PRESENCE_KEY, lotId));
        return count != null ? count : 0L;
    }
}
