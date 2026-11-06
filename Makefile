BUMP ?= patch

.PHONY: help install test check package release

help:
	@printf '%s\n' \
	    'make install                       Build this checkout and install it as the global spok command' \
	    'make test                          Run the unit tests' \
	    'make check                         Run lint, build, typecheck, and tests' \
	    'make package                       Build the release assets in dist-release/' \
	    'make release [BUMP=patch|minor|major]  Tag the next version on main and push it; CI publishes the release'

install: package
	SPOK_DOWNLOAD_BASE="$(CURDIR)/dist-release" sh install.sh

test:
	bun run test

check:
	bun run check

package:
	sh scripts/package-release.sh

release:
	BUMP=$(BUMP) sh scripts/release.sh
