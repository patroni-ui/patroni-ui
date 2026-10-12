.PHONY: all build run clean

IMAGE ?= armantarkhanian/patroni-ui
VERSION ?= 0.1.0
DIST ?= dist

all: build

# Build everything with Docker (no local Go/Node needed): the Docker image and
# the linux/windows amd64 binaries into ./dist.
build:
	IMAGE="$(IMAGE)" VERSION="$(VERSION)" DIST="$(DIST)" ./scripts/build.sh

run:
	./$(DIST)/patroni-ui-linux-amd64

clean:
	rm -rf $(DIST)
