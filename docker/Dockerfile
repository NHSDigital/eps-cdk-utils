FROM ubuntu:24.04

ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}


ARG VERSION

RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y upgrade \
    && apt-get -y install --no-install-recommends ca-certificates curl git jq make unzip wget \
    && apt-get clean

# install aws stuff
# Download correct AWS CLI for arch
RUN if [ "$TARGETARCH" = "arm64" ] || [ "$TARGETARCH" == "aarch64" ]; then \
    wget -O /tmp/awscliv2.zip "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip"; \
    else \
    wget -O /tmp/awscliv2.zip "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"; \
    fi && \
    unzip /tmp/awscliv2.zip -d /tmp/aws-cli && \
    /tmp/aws-cli/aws/install && \
    rm /tmp/awscliv2.zip && rm -rf /tmp/aws-cli

# Install ASDF
RUN ASDF_VERSION=0.18.0 && \
    if [ "$TARGETARCH" = "arm64" ] || [ "$TARGETARCH" = "aarch64" ]; then \
    wget -O /tmp/asdf.tar.gz https://github.com/asdf-vm/asdf/releases/download/v${ASDF_VERSION}/asdf-v${ASDF_VERSION}-linux-arm64.tar.gz; \
    else \
    wget -O /tmp/asdf.tar.gz https://github.com/asdf-vm/asdf/releases/download/v${ASDF_VERSION}/asdf-v${ASDF_VERSION}-linux-amd64.tar.gz; \
    fi && \
    tar -xvzf /tmp/asdf.tar.gz && \
    mv asdf /usr/bin

RUN useradd -ms /bin/bash cdkuser
RUN chown -R cdkuser /home/cdkuser
WORKDIR /home/cdkuser
USER cdkuser

ENV PATH="$PATH:/home/cdkuser/.asdf/shims/:/home/cdkuser/node_modules/.bin"

# Install ASDF plugins
RUN asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
# install some common node versions that are used in builds to speed things up
RUN asdf install nodejs 24.13.0

# copy files needed for deployment
COPY --chown=cdkuser docker/entrypoint.sh /home/cdkuser/

RUN echo "${VERSION}" > version.txt

ENTRYPOINT ["/home/cdkuser/entrypoint.sh"]
