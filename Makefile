guard-%:
	@ if [ "${${*}}" = "" ]; then \
		echo "Environment variable $* not set"; \
		exit 1; \
	fi

.PHONY: install build test publish release clean

install: install-python install-hooks install-node

install-node:
	npm ci

install-python:
	poetry install

install-hooks: install-python
	poetry run pre-commit install --install-hooks --overwrite

lint-node:
	npm run lint
	npm run lint --workspace packages/cdkConstructs

lint-githubactions:
	actionlint

lint-githubaction-scripts:
	shellcheck .github/scripts/*.sh

lint: lint-node lint-githubactions lint-githubaction-scripts

clean:
	rm -rf packages/cdkConstructs/lib
	rm -rf packages/cdkConstructs/coverage
	rm -rf lib

deep-clean: clean
	rm -rf .venv
	find . -name 'node_modules' -type d -prune -exec rm -rf '{}' +

check-licenses: check-licenses-node check-licenses-python

check-licenses-node:
	npm run check-licenses
	npm run check-licenses --workspace packages/cdkConstructs

check-licenses-python:
	scripts/check_python_licenses.sh

aws-configure:
	aws configure sso --region eu-west-2

aws-login:
	aws sso login --sso-session sso-session

test: clean
	npm run test --workspace packages/cdkConstructs

package: build
	mkdir -p lib/
	npm pack --workspace packages/cdkConstructs --pack-destination lib/

build:
	npm run build --workspace packages/cdkConstructs
