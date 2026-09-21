#!/usr/bin/env node
// Copyright (C) 2026-2026 Huawei Technologies Co., Ltd
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Compatibility entry point; all selection and reporting live in the shared harness.
import { main } from '../test/support/cli.mjs';
const aliases = { ut: ['ut.host', 'ut.guest'], 'ut-host': ['ut.host'], 'ut-guest': ['ut.guest'], st: ['st.agent-loop-mocked'], 'st-real': ['st.agent-loop-real'], 'st-npu': ['st.npu-smoke'] };
const ids = aliases[process.argv[2]];
try {
  if (!ids) throw new Error(`Unknown layer: ${process.argv[2]}`);
  process.env.CI_RESULT_ALIAS = process.argv[2];
  process.exitCode = await main(['run', ...ids.flatMap(id => ['--case', id]), ...process.argv.slice(3)]);
} catch (error) { console.error(error.message); process.exitCode = 2; }
