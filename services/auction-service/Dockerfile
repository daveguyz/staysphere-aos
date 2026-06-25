FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /workspace
COPY mvnw .
COPY .mvn .mvn
COPY pom.xml .
COPY shared/common-dto/pom.xml shared/common-dto/pom.xml
COPY shared/common-events/pom.xml shared/common-events/pom.xml
COPY shared/common-security/pom.xml shared/common-security/pom.xml
COPY services/auction-service/pom.xml services/auction-service/pom.xml
RUN ./mvnw dependency:go-offline -pl shared/common-dto,shared/common-events,shared/common-security,services/auction-service -am -q 2>/dev/null || true
COPY shared/ shared/
COPY services/auction-service/ services/auction-service/
RUN ./mvnw package -pl services/auction-service -am -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S staysphere && adduser -S staysphere -G staysphere
USER staysphere
COPY --from=builder /workspace/services/auction-service/target/*.jar app.jar
EXPOSE 8094
ENTRYPOINT ["java","-XX:+UseContainerSupport","-XX:MaxRAMPercentage=75.0","-Djava.security.egd=file:/dev/./urandom","-jar","app.jar"]
