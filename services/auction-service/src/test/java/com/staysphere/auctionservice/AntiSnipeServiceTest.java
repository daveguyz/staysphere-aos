package com.staysphere.auctionservice;

import com.staysphere.auctionservice.model.*;
import com.staysphere.auctionservice.repository.AuctionLotRepository;
import com.staysphere.auctionservice.service.AntiSnipeService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@DisplayName("Anti-Snipe Extension Tests")
class AntiSnipeServiceTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("staysphere_auction")
            .withUsername("staysphere")
            .withPassword("staysphere_secret");

    @Container
    @SuppressWarnings("resource")
    static GenericContainer<?> redis = new GenericContainer<>(
            DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    @DynamicPropertySource
    static void setProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url",         postgres::getJdbcUrl);
        registry.add("spring.datasource.username",    postgres::getUsername);
        registry.add("spring.datasource.password",    postgres::getPassword);
        registry.add("spring.flyway.enabled",         () -> true);
        registry.add("spring.data.redis.host",        redis::getHost);
        registry.add("spring.data.redis.port",        () -> redis.getMappedPort(6379));
        registry.add("spring.autoconfigure.exclude",
                () -> "org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration");
        registry.add("spring.data.elasticsearch.repositories.enabled", () -> false);
        registry.add("stripe.secret-key", () -> "sk_test_stub");
        registry.add("anthropic.api.key", () -> "");
        registry.add("mux.token-id",      () -> "");
        registry.add("mux.token-secret",  () -> "");
    }

    @Autowired AntiSnipeService antiSnipeService;
    @Autowired AuctionLotRepository lotRepository;

    @MockBean org.springframework.kafka.core.KafkaTemplate<String, Object> kafkaTemplate;

    private AuctionLot buildLot(boolean antiSnipeEnabled, int triggerSecs, int extensionSecs, int maxExtensions) {
        return AuctionLot.builder()
                .propertyId("prop-antis").sellerId("seller-1").title("Anti-Snipe Test")
                .auctionType(AuctionType.ENGLISH).status(AuctionLotStatus.OPEN)
                .startsAt(LocalDateTime.now().minusMinutes(30))
                .scheduledEndsAt(LocalDateTime.now().plusMinutes(5))
                .startingPrice(BigDecimal.valueOf(1000)).minimumBidIncrement(BigDecimal.valueOf(100))
                .currency("NAD").antiSnipeEnabled(antiSnipeEnabled)
                .antiSnipeTriggerSeconds(triggerSecs)
                .antiSnipeExtensionSeconds(extensionSecs)
                .maxAntiSnipeExtensions(maxExtensions)
                .antiSnipeExtensionCount(0)
                .depositRequired(false).kycRequired(false).totalBids(0).uniqueBidders(0)
                .build();
    }

    @Test
    @DisplayName("Bid within trigger window extends auction")
    void bidWithinTriggerWindow_extendsAuction() {
        AuctionLot lot = lotRepository.save(buildLot(true, 300, 300, 10));
        LocalDateTime originalEnd = lot.getScheduledEndsAt();

        // ms remaining = 60s, trigger = 300s → should extend
        boolean extended = antiSnipeService.checkAndExtend(lot, 60_000L);

        assertThat(extended).isTrue();
        assertThat(lot.getStatus()).isEqualTo(AuctionLotStatus.EXTENDED);
        assertThat(lot.getScheduledEndsAt()).isAfter(originalEnd);
        assertThat(lot.getScheduledEndsAt())
                .isEqualTo(originalEnd.plusSeconds(300));
        assertThat(lot.getAntiSnipeExtensionCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("Bid outside trigger window does NOT extend auction")
    void bidOutsideTriggerWindow_doesNotExtend() {
        AuctionLot lot = lotRepository.save(buildLot(true, 300, 300, 10));
        LocalDateTime originalEnd = lot.getScheduledEndsAt();

        // ms remaining = 600s, trigger = 300s → should NOT extend
        boolean extended = antiSnipeService.checkAndExtend(lot, 600_000L);

        assertThat(extended).isFalse();
        assertThat(lot.getScheduledEndsAt()).isEqualTo(originalEnd);
        assertThat(lot.getStatus()).isEqualTo(AuctionLotStatus.OPEN);
        assertThat(lot.getAntiSnipeExtensionCount()).isEqualTo(0);
    }

    @Test
    @DisplayName("Anti-snipe disabled — no extension even within window")
    void antiSnipeDisabled_neverExtends() {
        AuctionLot lot = lotRepository.save(buildLot(false, 300, 300, 10));

        boolean extended = antiSnipeService.checkAndExtend(lot, 10_000L);

        assertThat(extended).isFalse();
        assertThat(lot.getStatus()).isEqualTo(AuctionLotStatus.OPEN);
    }

    @Test
    @DisplayName("Max extensions reached — further extension refused")
    void maxExtensionsReached_refusesMoreExtensions() {
        AuctionLot lot = lotRepository.save(buildLot(true, 300, 60, 3));
        lot.setAntiSnipeExtensionCount(3); // already at max

        boolean extended = antiSnipeService.checkAndExtend(lot, 30_000L);

        assertThat(extended).isFalse();
        assertThat(lot.getAntiSnipeExtensionCount()).isEqualTo(3); // unchanged
    }

    @Test
    @DisplayName("Multiple extensions accumulate correctly")
    void multipleExtensions_accumulateCorrectly() {
        AuctionLot lot = lotRepository.save(buildLot(true, 300, 120, 5));
        LocalDateTime original = lot.getScheduledEndsAt();

        // First extension
        antiSnipeService.checkAndExtend(lot, 100_000L);
        assertThat(lot.getAntiSnipeExtensionCount()).isEqualTo(1);
        assertThat(lot.getScheduledEndsAt()).isEqualTo(original.plusSeconds(120));

        // Second extension
        antiSnipeService.checkAndExtend(lot, 50_000L);
        assertThat(lot.getAntiSnipeExtensionCount()).isEqualTo(2);
        assertThat(lot.getScheduledEndsAt()).isEqualTo(original.plusSeconds(240));

        // Still within max
        assertThat(lot.getAntiSnipeExtensionCount()).isLessThan(lot.getMaxAntiSnipeExtensions());
    }
}
