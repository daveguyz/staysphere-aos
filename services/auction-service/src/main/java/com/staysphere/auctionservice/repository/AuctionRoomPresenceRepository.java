package com.staysphere.auctionservice.repository;

import com.staysphere.auctionservice.model.AuctionRoomPresence;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface AuctionRoomPresenceRepository extends JpaRepository<AuctionRoomPresence, String> {

    Optional<AuctionRoomPresence> findBySessionIdAndIsActiveTrue(String sessionId);

    @Query("SELECT COUNT(p) FROM AuctionRoomPresence p WHERE p.auctionLotId = :lotId AND p.isActive = true")
    long countActiveViewers(@Param("lotId") String lotId);
}
