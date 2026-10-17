import fs from 'node:fs/promises';
import {FileBlob, PresentationFile} from 'file:///C:/Users/DEV/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const root='D:/Documents/UEMA/SRGOP2/.presentation-notes-build';
const notes=JSON.parse(await fs.readFile(`${root}/notes.json`,'utf8'));
const p=await PresentationFile.importPptx(await FileBlob.load('D:/Documents/UEMA/ADS UEMA/Desenv. Web/Vida_Util_Mais_Apresentacao.pptx'));
console.log((await p.inspect({kind:'slide',maxChars:3000})).ndjson);
let elapsed=0;
const time=s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
for(let i=0;i<notes.length;i++){
 const n=notes[i]; const s=p.slides.items[i];
 n.note=`FALA DA APRESENTAÇÃO\nTempo sugerido: ${time(n.duration)}. Tempo acumulado: ${time(elapsed)} a ${time(elapsed+n.duration)}.\n\n${n.speech}\n\nReferência de apoio (não ler em voz alta): ${n.source}`;
 if(i===0)n.note=`Roteiro completo: aproximadamente 12 minutos e 35 segundos, com pequenas pausas. Os tempos são orientativos.\n\n${n.note}`;
 elapsed+=n.duration;
 s.speakerNotes.textFrame.setText(n.note);
 const preview=await p.export({slide:s,format:'png',scale:0.8});
 await fs.writeFile(`${root}/slide-${i+1}.png`,new Uint8Array(await preview.arrayBuffer()));
 console.log(`Prepared slide ${i+1}`);
}
await fs.writeFile(`${root}/notes-complete.json`,JSON.stringify(notes,null,2));
await (await PresentationFile.exportPptx(p)).save(`${root}/notes-export.pptx`);
console.log('Notes export complete');
