.PHONY: install build test publish release clean lint

install: install-python install-hooks install-node

install-node:
	npm ci

install-python:
	poetry install

install-hooks: install-python
	poetry run pre-commit install --install-hooks --overwrite

lint:
	npm run lint
	npm run lint --workspace packages/cdkConstructs
	npm run lint --workspace packages/deploymentUtils

clean:
	rm -rf packages/cdkConstructs/lib
	rm -rf packages/cdkConstructs/coverage
	rm -rf packages/deploymentUtils/lib
	rm -rf packages/deploymentUtils/coverage
	rm -rf lib

deep-clean: clean
	rm -rf .venv
	find . -name 'node_modules' -type d -prune -exec rm -rf '{}' +

test: clean
	npm run test --workspace packages/cdkConstructs
	npm run test --workspace packages/deploymentUtils

package: build
	mkdir -p lib/
	npm pack --workspace packages/cdkConstructs --pack-destination lib/
	npm pack --workspace packages/deploymentUtils --pack-destination lib/

build:
	npm run build --workspace packages/cdkConstructs
	npm run build --workspace packages/deploymentUtils

docker-build:
	docker build -t eps-cdk-utils . -f docker/Dockerfile

%:
	@$(MAKE) -f /usr/local/share/eps/Mk/common.mk $@
