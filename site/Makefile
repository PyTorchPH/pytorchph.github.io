SHELL := /bin/bash
VENDOR_DIR = assets/vendor/
JEKYLL := bundle exec jekyll

.PHONY: install vendor build serve

install:
	bundle install
	npm ci --no-audit --no-fund

vendor:
	mkdir -p $(VENDOR_DIR)
	cp node_modules/jquery/dist/jquery.min.js node_modules/@popperjs/core/dist/umd/popper.min.js node_modules/anchor-js/anchor.min.js $(VENDOR_DIR)
	cp node_modules/bootstrap/dist/js/bootstrap.bundle.min.js $(VENDOR_DIR)bootstrap.min.js

build: install vendor
	JEKYLL_ENV=production $(JEKYLL) build

serve: install vendor
	JEKYLL_ENV=development $(JEKYLL) serve --incremental
