SHELL := /bin/bash

APP_DIR := cmd/iac-core/main.go
STAGE ?= dev
AWS_REGION ?= us-east-1

AWS_PROFILE ?= incochat

.PHONY: help
help:
	@echo "Targets:"
	@echo "  make deps                 Install Go and CDK deps"
	@echo "  make test                 Run Go tests"
	@echo "  make fmt                  Format Go code"
	@echo "  make synth                CDK synth"
	@echo "  make diff                 CDK diff --all"
	@echo "  make deploy               CDK deploy --all"
	@echo "  make deploy-edge          CDK deploy edge stack only"
	@echo "  make deploy-platform      CDK deploy platform stack only"
	@echo "  make deploy-network       CDK deploy network stack only"
	@echo "  make deploy-oidc          CDK deploy oidc stack only"
	@echo "  make bootstrap            CDK bootstrap"
	@echo "  make destroy              CDK destroy --all"
	@echo ""
	@echo "Env vars:"
	@echo "  STAGE=dev|staging|prod (default: dev)"
	@echo "  AWS_REGION=us-east-1 (default: us-east-1)"
	@echo "  AWS_PROFILE=your-profile (optional)"

.PHONY: deps
deps:
	@command -v cdk >/dev/null 2>&1 || (echo "CDK not found. Install with: npm i -g aws-cdk" && exit 1)
	@go mod tidy
	@go mod download

.PHONY: fmt
fmt:
	@gofmt -w .

.PHONY: test
test:
	@go test ./...

# Ensures CDK sees the right app entrypoint even if cdk.json is wrong.
.PHONY: synth
synth:
	@STAGE=$(STAGE) AWS_REGION=$(AWS_REGION) cdk synth -a "go run ./$(APP_DIR)"

.PHONY: diff
diff:
	@STAGE=$(STAGE) AWS_REGION=$(AWS_REGION) cdk diff --all -a "go run ./$(APP_DIR)"

.PHONY: bootstrap
bootstrap:
	@STAGE=$(STAGE) AWS_REGION=$(AWS_REGION) cdk bootstrap -a "go run ./$(APP_DIR)"

.PHONY: deploy
deploy:
	@STAGE=$(STAGE) AWS_REGION=$(AWS_REGION) cdk deploy --all -a "go run ./$(APP_DIR)"

.PHONY: deploy-network
deploy-network:
	@STAGE=$(STAGE) AWS_REGION=$(AWS_REGION) cdk deploy "incochat-$(STAGE)-network" -a "go run ./$(APP_DIR)"

.PHONY: deploy-platform
deploy-platform:
	@STAGE=$(STAGE) AWS_REGION=$(AWS_REGION) cdk deploy "incochat-$(STAGE)-platform" -a "go run ./$(APP_DIR)"

.PHONY: deploy-edge
deploy-edge:
	@STAGE=$(STAGE) AWS_REGION=$(AWS_REGION) cdk deploy "incochat-$(STAGE)-edge" -a "go run ./$(APP_DIR)"

.PHONY: deploy-oidc
deploy-oidc:
	@STAGE=$(STAGE) AWS_REGION=$(AWS_REGION) cdk deploy "incochat-$(STAGE)-oidc" -a "go run ./$(APP_DIR)"

.PHONY: destroy
destroy:
	@STAGE=$(STAGE) AWS_REGION=$(AWS_REGION) cdk destroy --all -a "go run ./$(APP_DIR)"
