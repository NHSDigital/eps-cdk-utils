#!/usr/bin/env bash

# shellcheck source=/dev/null
source /home/cdkuser/.asdf/asdf.sh

sed -i -n '/nodejs/p'  /home/cdkuser/workspace/.tool-versions
cd /home/cdkuser/workspace/ || exit

asdf install
reshim nodejs

export REQUIRE_APPROVAL=never
if [ "${SHOW_DIFF}" = "true" ]
then
    make cdk-diff
fi
if [ "${DEPLOY_CODE}" = "true" ]
then
    make cdk-deploy
fi
