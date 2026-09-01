IMAGE ?= smash-bots-agent:dev
ENV_FILE ?= .env

.PHONY: build run

build:
	docker build -t $(IMAGE) .

run:
	docker run --rm -it --env-file $(ENV_FILE) $(IMAGE)
