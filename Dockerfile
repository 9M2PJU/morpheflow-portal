# ---- Stage 1: build a trimmed Java 21 runtime & fetch morphe ----
FROM alpine:3.21 AS jre-build

RUN apk add --no-cache \
    openjdk21-jdk \
    ca-certificates-bundle \
    binutils

ARG JLINK_MODULES=java.base,java.desktop,java.logging,java.naming,java.sql,java.xml,jdk.net,java.management,jdk.unsupported,jdk.crypto.ec

RUN mkdir -p /rootfs/opt/java /rootfs/morpheflow/tools && \
    jlink \
    --add-modules ${JLINK_MODULES} \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=zip-9 \
    --output /rootfs/opt/java/runtime

RUN KEYSTORE=$(find /usr/lib/jvm -name cacerts | head -n 1) && \
    test -n "$KEYSTORE" && \
    cp -L "$KEYSTORE" /rootfs/opt/java/runtime/lib/security/cacerts && \
    test -s /rootfs/opt/java/runtime/lib/security/cacerts && \
    /rootfs/opt/java/runtime/bin/java -version

ARG MORPHE_VERSION=1.20.0
RUN wget -q -O /rootfs/morpheflow/tools/morphe-desktop-${MORPHE_VERSION}-all.jar \
    "https://github.com/MorpheApp/morphe-desktop/releases/download/v${MORPHE_VERSION}/morphe-desktop-${MORPHE_VERSION}-all.jar" && \
    ln -sf "/morpheflow/tools/morphe-desktop-${MORPHE_VERSION}-all.jar" /rootfs/morpheflow/tools/morphe.jar


# ---- Stage 2: app image ----
FROM python:3.12-alpine3.21

LABEL org.opencontainers.image.title="MorpheFlow" \
      org.opencontainers.image.description="Self-hosted edge management portal and build pipeline for Android packages (FastAPI + Morphe)" \
      org.opencontainers.image.source="https://github.com/wiwek13/MorpheFlow"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    JAVA_HOME=/opt/java/runtime \
    MORPHEFLOW_ROOT=/morpheflow
ENV PATH="${JAVA_HOME}/bin:${PATH}"

COPY --from=jre-build /rootfs/ /

WORKDIR /morpheflow

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    adduser -D -h /morpheflow -u 1000 morphe && \
    mkdir -p apps/original apps/patched tools/morpheflow-data/options tools/morpheflow-data/state tools/morphe-data && \
    chown -R morphe:morphe /morpheflow /opt/java

COPY --chown=morphe:morphe . .

USER morphe

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/api/version || exit 1

CMD ["python", "-m", "uvicorn", "web.backend.main:app", "--host", "0.0.0.0", "--port", "8080"]