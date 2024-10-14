#!/usr/bin/env bash
set -e

VERSION=$(cat version.txt)

echo "**************************************"
echo "RUNNING CDK_UTILS VERSION ${VERSION}"
echo "**************************************"
echo
echo

if [ -z "${CDK_APP_PATH}" ]; then
    echo "CDK_APP_PATH is unset or set to the empty string"
    exit 1
fi

# shellcheck source=/dev/null
source /home/cdkuser/.asdf/asdf.sh

sed -i -n '/nodejs/p'  /home/cdkuser/workspace/.tool-versions
cd /home/cdkuser/workspace/ || exit

asdf install
asdf reshim nodejs

export REQUIRE_APPROVAL=never
if [ "${SHOW_DIFF}" = "true" ]
then
    echo "Running diff"
    npx cdk diff \
		--app "npx ts-node --prefer-ts-exts ${CDK_APP_PATH}"
fi
if [ "${DEPLOY_CODE}" = "true" ]
then
    echo "Running deploy"
    npx cdk deploy \
		--app "npx ts-node --prefer-ts-exts ${CDK_APP_PATH}" \
        --all \
        --require-approval=never \
        --ci true
fi
