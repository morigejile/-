'use strict';
const assert=require('node:assert/strict');

// Real renderer/audio/CSS with a temporary synthetic long recording. The saved
// offline sessions remain unchanged and are reopened by the restart smoke.
async function run({mainWindow,evaluate,wait,click,capture}){
  const originalSize=mainWindow.getSize();
  await evaluate(`(()=>{
    const trainer=window.__trainingProductTrainer,record=trainer.trainingRecords.selected();
    const buffer=new ArrayBuffer(44+16000*120*2),wav=new DataView(buffer);
    const ascii=(offset,value)=>[...value].forEach((char,i)=>wav.setUint8(offset+i,char.charCodeAt(0)));
    ascii(0,'RIFF');wav.setUint32(4,buffer.byteLength-8,true);ascii(8,'WAVE');ascii(12,'fmt ');
    wav.setUint32(16,16,true);wav.setUint16(20,1,true);wav.setUint16(22,1,true);wav.setUint32(24,16000,true);
    wav.setUint32(28,32000,true);wav.setUint16(32,2,true);wav.setUint16(34,16,true);ascii(36,'data');wav.setUint32(40,buffer.byteLength-44,true);
    const url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
    window.__playbackSmoke={record,original:{audioUrl:record.audioUrl,segments:record.segments,fullText:record.fullText,
      durationMs:record.durationMs,structuredReport:record.structuredReport},url,theme:document.documentElement.dataset.theme};
    record.audioUrl=url;record.durationMs=120000;
    record.segments=Array.from({length:48},(_,i)=>({id:'playback-smoke-'+i,startMs:i*2000,endMs:(i+1)*2000,timingSource:'estimated',text:'这是第 '+(i+1)+' 段合成转写，用于核对紧凑排版、播放定位和长文阅读，不用于表达质量评估。'}));
    record.segments[0].text='嗯，我觉得这个计划很好。然后可以先试行两周。';
    record.fullText=record.segments.map(segment=>segment.text).join('');
    const report=record.structuredReport;
    const tokens=new Array(record.segments[0].text.length).fill(' ');
    for(const [word,kinds] of [['嗯','1'],['我觉得','2'],['很好','4'],['然后','1']]){
      const start=record.fullText.indexOf(word);
      tokens.splice(start,word.length,kinds,...Array(word.length-1).fill('-'));
    }
    const wordMatchMap=tokens.join('').trimEnd();
    const detailValues={'hedge-character-percent':3.57,'speech-duration-ms':19000,'text-rate-per-speech-minute':265.26,
      'between-speech-gap-count':1,'between-speech-gap-percent':9.52,'between-speech-gap-rate-per-expression-minute':2.86,'review-word-count':4};
    record.structuredReport={...report,
      evidenceRun:{...report.evidenceRun,value:{...report.evidenceRun.value,audio:{sampleRateHz:16000,sampleCount:1920000},
        segments:[{id:'speech-0',startSample:16000,endSample:48000},{id:'speech-1',startSample:80000,endSample:352000}]}},
      metricRun:{...report.metricRun,value:{...report.metricRun.value,localStatsSnapshot:{wordMatchMap},
        metrics:report.metricRun.value.metrics.map(item=>({...item,value:detailValues[item.id] ?? item.value}))}}};
    trainer.refreshPlaybackControls();trainer.renderCurrentReport(record);
    document.getElementById('report-information').open=false;
    document.getElementById('report-materials').open=true;
  })()`);
  try{
    await wait('synthetic WAV metadata and seek controls ready',`document.getElementById('recording-player').duration===120 && !document.getElementById('playback-forward').disabled`);
    const gapButton='button[aria-label^="回放 3"]';
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(gapButton)})?.checkVisibility()`),false);
    await evaluate(`window.__trainingProductTrainer.focusReportEvidence(window.__playbackSmoke.record,'metric:filler-count')`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(gapButton)})?.checkVisibility()`),true,
      'the interval and its replay action are visible after opening only the outer disclosure');
    const hits=['嗯','我觉得','很好','然后'];
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.metric-word-list mark')].filter(node=>node.checkVisibility()).map(node=>node.textContent)`),hits);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.playback-segment-text mark')].map(node=>node.textContent)`),hits,
      'the transcript marks the same saved hits as the report, including the whole 我觉得 and no unsaved substring hits');
    assert.equal(await evaluate(`document.querySelector('.playback-segment-text').textContent`), '嗯，我觉得这个计划很好。然后可以先试行两周。');
    assert.deepEqual(await evaluate(`(()=>{
      const {record}=window.__playbackSmoke,trainer=window.__trainingProductTrainer,report=record.structuredReport;
      const materials=document.getElementById('playback-segments');
      record.structuredReport=null;
      trainer.renderCurrentReport(record);
      const legacy={hits:materials.querySelectorAll('mark').length,text:materials.querySelector('.playback-segment-text').textContent};
      record.structuredReport=report;
      trainer.renderCurrentReport(record);
      return {legacy,restored:[...materials.querySelectorAll('mark')].map(node=>node.textContent)};
    })()`),{legacy:{hits:0,text:'嗯，我觉得这个计划很好。然后可以先试行两周。'},restored:hits});
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(gapButton)}).getAttribute('aria-label')`),'回放 3–5 秒（2 秒）的前后录音');
    await evaluate(`document.querySelector(${JSON.stringify(gapButton)}).click()`);
    await wait('gap playback starts before the selected interval',`(()=>{const audio=document.getElementById('recording-player');return !audio.paused&&audio.currentTime>=2&&audio.currentTime<3;})()`);
    await wait('gap playback stops with trailing context',`(()=>{const audio=document.getElementById('recording-player');return audio.paused&&audio.currentTime>=6&&audio.currentTime<6.8;})()`);
    await evaluate(`document.getElementById('recording-player').currentTime=0;
      document.getElementById('report-materials').scrollIntoView({block:'start',behavior:'instant'})`);
    await wait('transport is visible after returning from interval evidence',`(()=>{
      const button=document.getElementById('playback-forward'),rect=button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
    })()`);
    await click('#playback-forward');
    await wait('native audio seeks forward five seconds',`document.getElementById('recording-player').currentTime===5`);
    assert.equal(await evaluate(`document.getElementById('recording-player').currentTime`),5);
    assert.equal(await evaluate(`document.getElementById('recording-player').paused`),true);
    await click('#playback-backward');await wait('native audio seeks back to the beginning',`document.getElementById('recording-player').currentTime===0`);
    await evaluate(`(()=>{const seek=document.getElementById('playback-seek');seek.value=60;seek.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait('saved segment selected at 60 seconds',`document.querySelector('.playback-segment.is-current')?.dataset.segmentId==='playback-smoke-30'`);
    await click('#playback-toggle');await wait('native audio advances',`document.getElementById('recording-player').currentTime>60.2`);
    await wait('current line followed into view',`(()=>{const row=document.querySelector('.playback-segment.is-current').getBoundingClientRect(),toolbar=document.getElementById('report-audio').getBoundingClientRect(),region=document.getElementById('report-scroll').getBoundingClientRect();return row.top>=toolbar.bottom-1&&row.bottom<=region.bottom;})()`);
    const wheel=await evaluate(`(()=>{const r=document.getElementById('report-scroll').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.bottom-60)};})()`);
    mainWindow.webContents.sendInputEvent({type:'mouseWheel',...wheel,deltaX:0,deltaY:160});
    await wait('reading pauses follow',`!document.getElementById('playback-follow').checked&&!document.getElementById('playback-return').hidden`);
    await click('#playback-return');
    await wait('return restores follow',`document.getElementById('playback-follow').checked`);
    const returned=await evaluate(`({open:document.getElementById('report-materials').open,follow:document.getElementById('playback-follow').checked,hidden:document.getElementById('playback-return').hidden,active:document.activeElement.id})`);
    assert.equal(returned.open&&returned.follow,true,'return action state: '+JSON.stringify(returned));
    await click('#playback-toggle');await wait('native audio paused',`document.getElementById('recording-player').paused`);
    await click('#playback-follow');
    assert.equal(await evaluate(`document.getElementById('report-materials').open&&!document.getElementById('playback-follow').checked`),true,'switch toggles without collapsing the disclosure');
    const position=await evaluate(`document.getElementById('recording-player').currentTime`);
    await click('#playback-return');
    await wait('paused return restores follow',`document.getElementById('playback-follow').checked`);
    assert.equal(await evaluate(`document.getElementById('recording-player').currentTime`),position);
    assert.equal(await evaluate(`document.getElementById('recording-player').paused`),true);
    assert.equal(await evaluate(`document.activeElement.id`),'playback-follow','hidden return action retains keyboard navigation');
    await evaluate(`document.getElementById('playback-follow').focus()`);
    mainWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});mainWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
    await wait('keyboard switch off',`!document.getElementById('playback-follow').checked`);
    assert.equal(await evaluate(`document.getElementById('recording-player').paused&&document.getElementById('report-materials').open`),true);
    await click('.playback-follow-label span');
    await wait('label text enables follow',`document.getElementById('playback-follow').checked`);
    assert.equal(await evaluate(`document.getElementById('report-materials').open`),true,'label text never collapses the disclosure');
    await click('#playback-follow');
    await wait('switch off for layout checks',`!document.getElementById('playback-follow').checked`);
    await evaluate('document.fonts.ready');
    for(const width of [960,1280,1440]){
      mainWindow.setContentSize(width,800);
      await wait('playback viewport resize',`innerWidth===${width}`);
      for(const theme of ['graphite','coral-glow','ink-night','frosted-mist']){
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.getElementById('report-scroll').scrollTop=document.getElementById('report-scroll').scrollHeight/2`);
        const layout=await evaluate(`(()=>{
          const region=document.getElementById('report-scroll'),toolbar=document.getElementById('report-audio'),heading=document.getElementById('report-materials-heading'),seek=document.getElementById('playback-seek'),actions=document.querySelector('.playback-actions'),controls=document.querySelector('.playback-toolbar');
          const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,width:r.width};};
          const follow=document.querySelector('.playback-follow-label'),speed=document.querySelector('.playback-speed-label'),row=document.querySelector('.playback-segment-button'),text=document.querySelector('.playback-segment-text');
          return {viewport:innerWidth,page:document.documentElement.scrollWidth,region:rect(region),toolbar:rect(toolbar),heading:rect(heading),rail:rect(seek),actions:rect(actions),controls:rect(controls),timeline:rect(document.querySelector('.playback-timeline')),times:rect(document.querySelector('.playback-time')),volume:rect(document.querySelector('.playback-sound')),follow:rect(follow),speed:rect(speed),
            volumeRail:rect(document.getElementById('playback-volume')),mute:rect(document.getElementById('playback-mute')),back:rect(document.getElementById('playback-backward')),play:rect(document.getElementById('playback-toggle')),forward:rect(document.getElementById('playback-forward')),
            timeGap:rect(document.getElementById('playback-duration')).left-rect(document.getElementById('playback-current-time')).right,timeText:document.querySelector('.playback-time').textContent,
            followGap:rect(document.getElementById('playback-follow')).left-rect(follow.querySelector('span')).right,speedLabel:speed.querySelector('span')?.textContent||'',speedOptions:[...document.getElementById('playback-speed').options].map(option=>option.value),
            rowPadding:parseFloat(getComputedStyle(row).paddingTop),textLeading:parseFloat(getComputedStyle(text).lineHeight)/parseFloat(getComputedStyle(text).fontSize),
            fits:[...document.querySelectorAll('.playback-toolbar button,.playback-toolbar input,.playback-toolbar select,.playback-follow-label,#playback-return')].filter(node=>node.checkVisibility()).every(node=>{const r=node.getBoundingClientRect(),p=region.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;}),
            surface:getComputedStyle(toolbar).backgroundColor,headerSurface:getComputedStyle(heading).backgroundColor,
            currentShadow:getComputedStyle(document.querySelector('.playback-segment.is-current button')).boxShadow,
            ordinaryColor:getComputedStyle(text).color,ordinaryWeight:Number(getComputedStyle(text).fontWeight),
            hits:[...text.querySelectorAll('mark')].map(node=>({color:getComputedStyle(node).color,weight:Number(getComputedStyle(node).fontWeight)})),
            metricStylesMatch:[...document.querySelectorAll('.metric-grid>.metric-item')].every(item=>{
              const sameTextStyle=(node,reference)=>['fontSize','fontWeight','lineHeight','letterSpacing','color'].every(key=>
                getComputedStyle(node)[key]===getComputedStyle(reference)[key]);
              const style=getComputedStyle(item);
              return style.borderTopWidth==='0px'&&style.backgroundColor==='rgba(0, 0, 0, 0)'&&
                sameTextStyle(item.querySelector('dt'),document.querySelector('#report-summary-metrics span'))&&
                sameTextStyle(item.querySelector('dd'),document.querySelector('#report-summary-metrics strong'));
            }),
            clip:parseFloat(document.getElementById('report-transcript').style.getPropertyValue('--playback-transcript-clip'))};
        })()`);
        assert.ok(layout.page<=layout.viewport&&layout.fits,theme+' controls fit '+width);
        assert.ok(Math.abs(layout.heading.top-layout.region.top)<2,'material title stays pinned');
        assert.ok(Math.abs(layout.toolbar.top-layout.heading.bottom)<2,'player stays below its title');
        assert.equal(layout.surface,layout.headerSurface,'sticky surfaces share the project theme');
        assert.equal(layout.surface,'rgba(0, 0, 0, 0)','controls expose the actual report material instead of painting a different surface');
        const center=rect=>rect.top+rect.height/2;
        assert.ok(layout.timeline.right<layout.controls.left&&layout.timeline.width>layout.controls.right-layout.controls.left,'wide progress area stays left of the compact controls');
        assert.ok(Math.abs(layout.controls.left-layout.timeline.right-28)<2,'accepted 28px separation');
        assert.ok(Math.abs(layout.controls.width-200)<2,'accepted compact 200px control width');
        assert.ok(Math.abs(center(layout.rail)-center(layout.volume))<2&&Math.abs(center(layout.volume)-center(layout.speed))<2,'volume and speed align with the progress bar');
        assert.ok(Math.abs(center(layout.times)-center(layout.actions))<2&&Math.abs(center(layout.times)-center(layout.follow))<2,'transport and follow align with the times');
        assert.ok(layout.follow.left>=layout.timeline.left&&layout.follow.right<=layout.timeline.right+1,'follow stays in the left progress area');
        assert.ok(Math.abs(layout.mute.left-layout.back.left)<1,'upper and lower left controls share an edge');
        assert.ok(Math.abs(layout.speed.right-layout.forward.right)<1,'upper and lower right controls share an edge');
        assert.ok(Math.abs(layout.volumeRail.right-layout.play.right)<1,'volume rail ends at the play button right edge');
        assert.ok(Math.abs((layout.play.left+layout.play.right)/2-(layout.controls.left+layout.controls.right)/2)<1,'play button stays centered in the right control module');
        assert.match(layout.timeText,/\d{2}:\d{2}\s*\/\s*02:00/,'elapsed and total time are combined');
        assert.ok(layout.timeGap>0&&layout.timeGap<28,'combined times stay adjacent on a wide rail');
        assert.ok(Math.abs(layout.followGap-8)<1,'follow label stays close to its switch');
        assert.equal(layout.speedLabel,'','speed dropdown has no redundant visible label');
        assert.deepEqual(layout.speedOptions,['0.25','0.5','0.75','1','1.25','1.5','1.75','2'],'all playback speeds remain available');
        assert.equal(layout.rowPadding,6,'transcript rows use compact vertical padding');
        assert.ok(layout.hits.length===hits.length && layout.hits.every(hit=>hit.weight>layout.ordinaryWeight && hit.color===layout.ordinaryColor),theme+' marks are bold and match the transcript color');
        assert.equal(layout.metricStylesMatch,true,theme+' detail metrics are borderless and match summary typography');
        assert.ok(layout.textLeading>=1.7,'multi-line transcript keeps readable line height');
        assert.ok(layout.actions.top>=layout.volume.bottom&&layout.actions.top>=layout.speed.bottom,'transport stays below volume and speed');
        assert.equal(layout.currentShadow,'none','current transcript has no dark vertical inset');
        assert.ok(layout.clip>0,'scrolled transcript is clipped underneath the transparent controls');
        if(width===1280)await capture('playback-'+theme);
      }
    }
    await evaluate(`document.getElementById('report-materials').open=false`);
    assert.equal(await evaluate(`document.getElementById('playback-player').checkVisibility()`),false,'collapsed player is not painted or interactive');
    assert.ok(await evaluate(`document.getElementById('report-materials').getBoundingClientRect().height<80`),'collapsed disclosure occupies only its heading');
    mainWindow.setContentSize(1280,950);
    await wait('report details screenshot viewport',`innerWidth===1280&&innerHeight===950`);
    for(const theme of ['coral-glow','ink-night']){
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.getElementById('report-scroll').scrollTop=document.getElementById('report-information').offsetTop`);
      await capture('report-details-'+theme);
    }
  }catch(error){await capture('playback-failure');throw error;}finally{
    await evaluate(`(()=>{const state=window.__playbackSmoke,trainer=window.__trainingProductTrainer;document.getElementById('recording-player').pause();Object.assign(state.record,state.original);trainer.refreshPlaybackControls();trainer.renderCurrentReport(state.record);URL.revokeObjectURL(state.url);if(state.theme)document.documentElement.dataset.theme=state.theme;else delete document.documentElement.dataset.theme;delete window.__playbackSmoke;})()`);
    mainWindow.setSize(...originalSize);
  }
}
module.exports={run};
