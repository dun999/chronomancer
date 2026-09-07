import { mkdirSync,writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { cardSvg } from '../src/assistant/cards.js';
import type { PositionView } from '../src/assistant/types.js';
const example:PositionView={
 market:{id:`0x${'0'.repeat(64)}`,pool:`0x${'0'.repeat(40)}`,asset:'BTC',question:'Will BTC close at or above its opening price?',expiry:0,tradingStart:0,decimals:6,venueId:'example',upAsk:null,downAsk:null,upBid:null,downBid:null},
 side:'Up',balance:'22222000',cost:'9999900',value:'12666540',pnl:'2666640',realized:'0',status:'Example position',asOf:Date.parse('2026-09-06T10:00:00Z'),indexed:true,
};
const svg=cardSvg(example,7).replace('SOMNIA TESTNET','SAMPLE DATA');
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/position-card-preview.svg',svg);
writeFileSync('artifacts/position-card-preview.png',new Resvg(svg,{font:{loadSystemFonts:true,defaultFontFamily:'DejaVu Sans'}}).render().asPng());
console.log('Created sample-data position card preview.');
