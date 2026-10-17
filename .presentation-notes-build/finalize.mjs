import fs from 'node:fs/promises';
import {finalizePresentation} from 'file:///C:/Users/DEV/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations/container_tools/artifact_tool_utils.mjs';
const workspaceDir='D:/Documents/UEMA/SRGOP2';
process.env.RUNTIME_NODE_MODULES='C:/Users/DEV/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const build=`${workspaceDir}/.presentation-notes-build`;
const skill='C:/Users/DEV/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
await fs.mkdir(`${workspaceDir}/output`,{recursive:true});
const result=await finalizePresentation({workspaceDir,candidatePath:`${build}/candidate.pptx`,finalPath:`${workspaceDir}/output/Vida_Util_Mais_Apresentacao_com_Falas.pptx`,pythonExecutable:'C:/Users/DEV/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:`${skill}/container_tools/inspect_presentation_package_integrity.py`,layoutValidatorPath:`${skill}/container_tools/inspect_presentation_layout_geometry.py`,layoutArgs:['--expected-slide-size-emu','12192000,6858000'],explicitTotalSlideCount:12,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],verifyArtifactToolImport:true,receiptPath:`${build}/validation.json`});
console.log(JSON.stringify(result));
