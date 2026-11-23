(function(){
  var BOOKING_ENDPOINT="https://script.google.com/macros/s/AKfycby_8v8seWol3G1XXb9NlamfiYQTKA6Rk9pPHNqss1bTrSx1ONTVlY8BeG0Qg1m4vfKHaA/exec";
  /* Notify Worker: emails Jessica when a call is booked, when a visitor
     leaves a message, or when the agent cannot answer a question.
     Tests override the endpoint with window.__hcNotifyUrl. */
  var NOTIFY_URL=(typeof window!=="undefined"&&window.__hcNotifyUrl)?window.__hcNotifyUrl:"https://website-agent-notify.millrjess.workers.dev/api/notify";
  var BOOKING_PAGE="../booking/";
  var STRIPE_STRATEGY_URL="https://buy.stripe.com/aFa7sMfCM43Nc8JdOF6EU02";
  var BOOK_ANSWER="I can book the free 15-minute discovery call right here. It is free, by phone, with no obligation, on a Tuesday or Thursday. A 1-hour strategy session is $200, paid in advance at booking through Stripe.";
  var HOW_WE_WORK_ANSWER="Ongoing care: compare care plans, book a call, then receive onboarding at no extra charge.<br>Projects: choose a service, check its starting price, then book a call.<br>Strategy Session: one hour, $200, payable at booking.";
  var answers=[
    {k:["how we work together","how do we work together","how does this work"],a:HOW_WE_WORK_ANSWER},
    {k:["strategy session","strategy"],a:"A 1-hour strategy session is $200, paid in advance at booking through Stripe, with a receipt. After payment, I will arrange a time with you and confirm every booking personally before it is final. If we cannot find a time that works, you will be refunded."},
    {k:["price","cost","fee","charge","rate"],a:"A 1-hour strategy session is $200, paid in advance. Care plans are $150 per month for Essential and $300 per month for Professional, with two months at no charge when paid annually. One time services start from $500 for a Site Health Audit, from $750 for a Website Standards Pass, and from $1,250 for a WCAG Accessibility Audit. An AI security agent build starts from $7,500, with the security agent add-on at $200 per month and AI Agent Management at $200 per month. See the full <a href='../pricing/'>pricing page</a> for every price."},
    {k:["book","consultation","session","appointment"],a:BOOK_ANSWER},
    {k:["free"],a:"The Free 15-Minute Discovery Call has no charge and no obligation. It is a phone call to discuss your website, your goals, and the problem you want to solve."},
    {k:["200","paid","pay","stripe","refund"],a:"A 1-hour strategy session is $200, paid in advance through Stripe, with a receipt. No session starts until payment is received. After payment, I will arrange a time with you and confirm every booking personally before it is final. If we cannot find a time that works, you will be refunded."},
    {k:["care plan","maintenance","support","monthly"],a:"Essential, $150 per month, includes CMS updates, daily off site backups, uptime monitoring, and a monthly site health report. Professional, $300 per month, adds security hardening and malware scanning, performance checks, one hour of content or design updates, and priority support. See <a href='../pricing/'>Pricing</a>."},
    {k:["audit","health"],a:"A Site Health Audit starts from $500 and reviews technical SEO, security configuration, and website performance, with a prioritized action plan."},
    {k:["seo"],a:"Technical SEO starts from $1,000. Work may include structured data, crawl and indexing fixes, page speed improvements, and GA4 measurement setup. Search rankings are not guaranteed."},
    {k:["accessib","wcag"],a:"A WCAG Accessibility Audit and Remediation starts from $1,250, with prioritized fixes to meet WCAG 2.2 AA, the practice standard. A Website Standards Pass starts from $750 and corrects against WCAG 2.2 AA, the practice standard."},
    {k:["malware","hacked","security"],a:"Malware Removal and Incident Response starts from $500 per incident, including investigation, cleanup, vulnerability remediation, and security hardening within the agreed scope."},
    {k:["location","where","boston","andover","remote","onsite","zoom"],a:"Based in North Andover, MA 01845, serving Boston, Greater Boston's North Shore, and the Merrimack Valley, plus remote clients nationwide. Sessions are on Zoom, nationwide, and on-site by arrangement in Boston, Greater Boston's North Shore, and the Merrimack Valley, including the Andovers."},
    {k:["wordpress","drupal","joomla","platform"],a:"Ongoing care covers WordPress, Drupal, Joomla, and custom database driven websites."},
    {k:["start","begin","contact","email","phone"],a:"Start on the booking page, or email millrjess@gmail.com, or call (978) 267-5304. I read and reply to every inquiry personally, within 1 business day."},
    {k:["resume","cv","curriculum vitae","work history","qualifications"],a:"Here is Jessica's resume: <a href='../resume/'>Resume</a>, with her full work history, certifications, and education. A print-ready PDF is here: <a href='../assets/jessica-miller-resume.pdf'>Resume (PDF)</a>."},
    {k:["website agent","what are you","who are you","can i get one","build me an agent","want an agent","one for my website"],a:"I am Jessica's website agent. She builds agents like me for client websites. See <a href='../services/#website-agents'>Website Agents</a>."},
    {k:["agent","website agent","chatbot"],a:"Website Agents handle lead qualification, customer support, data processing, and multi step workflows. Integrations, permitted actions, and human review requirements are defined before development begins."}
  ];

  var siteIndex=[
    {k:["home","consultant","website operations"],u:"../",d:"Home: Jessica A. Miller, Website Operations Consultant, 29 years in websites, with a six-year break for full-time parenting and writing, keeping business websites fast, secure, and online."},
    {k:["service","care plan","maintenance","seo","agent","audit","standards"],u:"../services/",d:"Services: care plans, one time projects, Website Agents, Standards Pass, technical SEO, and performance."},
    {k:["fee","price","pricing","cost"],u:"../pricing/",d:"Pricing: published prices for care plans, audits, development, agents, and strategy sessions, with pricing sources."},
    {k:["book","consultation","discovery","session","appointment"],u:"../booking/",d:"Booking: Free 15-Minute Discovery Call, and 1-hour strategy session, $200 paid in advance, approval before confirmation."},
    {k:["contact","email","phone","message"],u:"../contact/",d:"Contact: email millrjess@gmail.com, call (978) 267-5304, North Andover, MA."},
    {k:["faq","question","how"],u:"../faqs/",d:"FAQs: project timing, support, working with a team, prices, booking, refund, care plans, remote work, and platforms."},
    {k:["about","story","background","experience"],u:"../about/",d:"About: 29 years in websites, with a six-year break for full-time parenting and writing, and a return to client work in 2026."},
    {k:["certif","course","credential"],u:"../certifications/",d:"Certifications: 34 course certificates with verification links."},
    {k:["recommend","testimonial","review"],u:"../testimonials/",d:"Testimonials: dated LinkedIn recommendations."},
    {k:["portfolio","project","case study","capstone"],u:"../portfolio/",d:"Work & Credentials: selected work in product, data, and design, plus course certificates and recommendations."},
    {k:["tracker","glp-1","new chapter","app"],u:"../tracker/",d:"New Chapter: GLP-1 Tracker™, an independent product by Jessica, separate from consulting services."},
    {k:["book","ledger","novel","author","fiction"],u:"../books/",d:"Books: The Ledger Series, The Second Account, The Echo Trace, and The Ghost Index."},
    {k:["resume","cv","curriculum","work history","qualifications"],u:"../resume/",d:"Resume: Website Operations Consultant, full work history, certifications, and education."},
    {k:["fee schedule","fees"],u:"../fee-schedule/",d:"Fee Schedule: published fees for care plans and services."},
    {k:["accessibility","why accessibility"],u:"../accessibility/",d:"Why Accessibility and UX Matter: accessibility and user experience."},
    {k:["wellness","health journey"],u:"../wellness/",d:"A New Chapter in My Health Journey: Jessica's GLP-1 wellness story."},
    {k:["parish","case study"],u:"../case-study-website/",d:"Parish Website Case Study."},
    {k:["foodie","mobile app case study"],u:"../case-study-mobile-app/",d:"Foodie Explorer: UX Design Case Study."},
    {k:["checkr","background"],u:"https://checkr.com/profiles/jessica-miller-aa27",d:"Checkr public profile: identity verified, Website Operations Consultant, North Andover, MA."}
  ];
  var SEARCH_PREFIXES=["search for ","show me ","bring up ","take me to ","where is ","where's ","where are ","find ","search ","show ","bring ","open ","go to "];
  function stripSearchPrefix(q){
    for(var p=0;p<SEARCH_PREFIXES.length;p++){ if(q.indexOf(SEARCH_PREFIXES[p])===0) return q.slice(SEARCH_PREFIXES[p].length); }
    return q;
  }
  function isSearchCommand(q){
    for(var p=0;p<SEARCH_PREFIXES.length;p++){ if(q.indexOf(SEARCH_PREFIXES[p])===0) return true; }
    return false;
  }
  function siteSearch(q){
    var hits=[];
    for(var i=0;i<siteIndex.length;i++){
      for(var j=0;j<siteIndex[i].k.length;j++){
        if(q.indexOf(siteIndex[i].k[j])>-1){ hits.push(siteIndex[i]); break; }
      }
    }
    if(!hits.length) return null;
    var out="I found this on the site: ";
    for(var h=0;h<Math.min(hits.length,3);h++){ out += "<a href='"+hits[h].u+"'>"+hits[h].d+"</a> "; }
    return out;
  }
  function find(q){
    q=q.toLowerCase();
    q=stripSearchPrefix(q);
    for(var i=0;i<answers.length;i++){
      for(var j=0;j<answers[i].k.length;j++){
        if(q.indexOf(answers[i].k[j])>-1) return answers[i].a;
      }
    }
    var s=siteSearch(q); if(s) return s;
    return "I do not have a published answer for that. Please email millrjess@gmail.com, call (978) 267-5304, or use the booking page, and Jessica will reply personally. This chat asks a few questions first, then books a Free 15-Minute Discovery Call or sends you to pay for a strategy session. Only Jessica can confirm a strategy session, change a price, or start work in this chat.";
  }
  /* Booking agent: books the free 15-minute discovery call in the chat.
     The call is free, by phone, Tuesday and Thursday, 10 AM to noon and
     1 to 3 PM Eastern. Strategy sessions are never booked here. */
  var bk={step:null,name:"",email:"",phone:"",website:"",topic:"",slots:[],slot:null,eventLabel:"",reschedEmail:"",cancelEmail:"",cancelLabel:"",booked:false,qualService:"",qualBudget:"",qualTimeline:"",qualOther:"",qualified:false};
  /* Proactive agent: offers help once when a visitor struggles, and never
     nags. Three triggers: two failed validations on the same booking field,
     60 seconds idle on the pricing page with the panel closed, and two
     questions in a row the agent could not answer. */
  var PROACTIVE_IDLE_MS=60000;
  var PROACTIVE_FORM_COPY="That step is giving trouble. I can walk you through it, or you can email Jessica at millrjess@gmail.com.";
  var PROACTIVE_IDLE_COPY="Questions about pricing? I can explain a plan or a price, or book a free call.";
  var PROACTIVE_UNANSWERED_COPY="I could not answer that. Would a free 15-minute call help? I can book one.";
  var proactiveOffered={form:false,idle:false,unanswered:false};
  var proactiveFormFails={};
  var proactiveFallbacks=0;
  var proactiveBubble=null;
  var proactiveChatOpened=false;
  function proactiveOffer(kind,text){
    if(proactiveOffered[kind]) return;
    proactiveOffered[kind]=true;
    var log=hcLog();
    if(panel.style.display!=="none"){ say(log,text); return; }
    if(proactiveBubble) return;
    var bubble=document.createElement("div");
    bubble.id="hc-proactive";
    bubble.setAttribute("role","status");
    bubble.style.cssText="position:fixed;right:20px;bottom:88px;z-index:100;width:300px;max-width:calc(100vw - 40px);box-sizing:border-box;background:#fff;border:2px solid #0b1a30;border-radius:12px;box-shadow:0 14px 34px -18px rgba(15,35,64,.22);padding:12px;font-family:inherit;color:#334155";
    var offer=document.createElement("button");
    offer.type="button";
    offer.textContent=text;
    offer.style.cssText="display:block;width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer;font:inherit;color:#0f2340";
    var close=document.createElement("button");
    close.type="button";
    close.setAttribute("aria-label","Dismiss this offer");
    close.textContent="X";
    close.style.cssText="position:absolute;top:6px;right:8px;background:#f0dfae;border:2px solid #0b1a30;border-radius:999px;font-size:.85em;font-weight:700;line-height:1;cursor:pointer;color:#0b1a30;padding:.25em .5em;min-width:28px;min-height:28px";
    offer.onclick=function(){ var b=proactiveBubble; proactiveBubble=null; if(b) b.remove(); panel.style.display="flex"; btn.setAttribute("aria-expanded","true"); proactiveChatOpened=true; say(hcLog(),text); document.getElementById("hc-q").focus(); };
    close.onclick=function(){ var b=proactiveBubble; proactiveBubble=null; if(b) b.remove(); btn.focus(); };
    bubble.appendChild(offer);
    bubble.appendChild(close);
    proactiveBubble=bubble;
    document.body.appendChild(bubble);
  }
  function proactiveFormError(field){
    var n=(proactiveFormFails[field]||0)+1;
    proactiveFormFails[field]=n;
    if(n===2) proactiveOffer("form",PROACTIVE_FORM_COPY);
  }
  function proactiveFormPassed(field){ proactiveFormFails[field]=0; }
  function proactiveFallback(){
    proactiveFallbacks++;
    if(proactiveFallbacks===2) proactiveOffer("unanswered",PROACTIVE_UNANSWERED_COPY);
  }
  function proactiveAnswered(){ proactiveFallbacks=0; }
  /* Voice agent: speak instead of type, and hear the replies. The
     microphone always records and the recording is sent to Cloudflare
     only to be transcribed into text; built-in speech recognition is
     never used for input because it fails silently on iOS (no prompt,
     immediate error). Read-aloud uses the Azure TTS Worker (Jenny)
     only. There is no fallback voice: if the Worker cannot be reached,
     the reply stays silent and the text is on screen.
     Audio is never stored and never used to train. Text stays available
     always. */
  var voiceListening=false;
  var voiceReadAloud=false;
  var voiceRecog=null;
  /* Recorder for voice input: the microphone records and the recording
     is sent to Cloudflare only to be transcribed into text. Tests
     override the endpoint with window.__hcTranscribeUrl. */
  var VOICE_TRANSCRIBE_URL=(typeof window!=="undefined"&&window.__hcTranscribeUrl)?window.__hcTranscribeUrl:"https://website-agent-transcribe.millrjess.workers.dev/api/transcribe";
  /* Read-aloud: the Azure TTS Worker speaks replies in Jenny's voice.
     There is no fallback voice. Tests
     override the endpoint with window.__hcTtsUrl. */
  var VOICE_TTS_URL=(typeof window!=="undefined"&&window.__hcTtsUrl)?window.__hcTtsUrl:"https://website-agent-tts.millrjess.workers.dev/api/speak";
  var VOICE_TTS_VOICE="en-US-JennyNeural";
  var VOICE_TTS_TIMEOUT_MS=10000;
  var voiceAudio=null;
  /* Stop the Azure audio, if any is playing, and release its object
     URL. Clearing voiceAudio first means a stale onended/onerror
     handler on the stopped element cannot act on it. */
  function voiceStopAudio(){
    var a=voiceAudio;
    voiceAudio=null;
    if(!a) return;
    try{ a.pause(); }catch(e){}
    try{ if(a.__hcObjUrl) URL.revokeObjectURL(a.__hcObjUrl); }catch(e){}
  }
  var VOICE_REC_MAX_MS=60000;
  var voiceRecording=false;
  var voiceRecorder=null;
  var voiceRecStream=null;
  var voiceRecTimer=null;
  function voiceSpeechRecog(){
    return window.SpeechRecognition||window.webkitSpeechRecognition||null;
  }
  function voiceStripHtml(html){
    var d=document.createElement("div");
    d.innerHTML=html;
    return (d.textContent||"").replace(/\s+/g," ").trim();
  }
  /* One voice only: Jenny, from the Azure TTS Worker. There is no
     fallback to the phone's built-in voice, so a second voice can never
     speak over her. A speak request counts up, and a request that is no
     longer the newest is dropped when its audio arrives, so a slow
     reply can never play over a newer one. */
  var voiceSpeakSeq=0;
  /* The most recent agent message in the log, as plain text. User echoes
     carry a "You:" strong tag and are skipped. Falls back to the intro
     when the log has no agent message yet. */
  function voiceLastAgentText(){
    var log=hcLog();
    if(log){
      var ps=log.querySelectorAll("p");
      for(var i=ps.length-1;i>=0;i--){
        if(ps[i].querySelector("strong")) continue;
        var t=(ps[i].textContent||"").replace(/\s+/g," ").trim();
        if(t) return t;
      }
    }
    var all=panel.querySelectorAll("p");
    for(var j=0;j<all.length;j++){
      var it=(all[j].textContent||"").replace(/\s+/g," ").trim();
      if(it.indexOf("I am Jessica's website agent.")===0) return it;
    }
    return "";
  }
  /* Jenny only, from the Azure TTS Worker. Any failure (network error,
     an error status, an empty reply, a hung request, or an audio element
     that cannot play) stays silent: the text is on screen, and no other
     voice is ever used. A request that is no longer the newest is
     dropped when its audio arrives. */
  function voiceSpeakAzure(plain,seq){
    if(!voiceReadAloud) return;
    var done=false;
    var timer=null;
    function fail(){
      if(done) return;
      done=true;
      if(timer){ clearTimeout(timer); timer=null; }
    }
    timer=setTimeout(fail,VOICE_TTS_TIMEOUT_MS);
    var body;
    try{ body=JSON.stringify({text:plain,voice:VOICE_TTS_VOICE,rate:"+0%",pitch:"+0st"}); }catch(e){ fail(); return; }
    fetch(VOICE_TTS_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:body}).then(function(r){
      if(!r.ok) throw new Error("tts "+r.status);
      return r.blob();
    }).then(function(blob){
      if(done||seq!==voiceSpeakSeq) return;
      if(!blob||!blob.size) throw new Error("tts empty");
      if(timer){ clearTimeout(timer); timer=null; }
      /* An earlier reply may have started playing after this request
         was sent. Stop it first, so only this reply is heard. */
      voiceStopAudio();
      var objUrl;
      try{ objUrl=URL.createObjectURL(blob); }catch(e){ fail(); return; }
      var audio=new Audio(objUrl);
      audio.__hcObjUrl=objUrl;
      voiceAudio=audio;
      audio.onended=function(){
        if(voiceAudio!==audio) return;
        voiceAudio=null;
        try{ URL.revokeObjectURL(objUrl); }catch(e){}
      };
      audio.onerror=function(){
        if(voiceAudio!==audio) return;
        voiceAudio=null;
        try{ URL.revokeObjectURL(objUrl); }catch(e){}
        fail();
      };
      var p=null;
      try{ p=audio.play(); }catch(e){
        if(voiceAudio===audio) voiceAudio=null;
        try{ URL.revokeObjectURL(objUrl); }catch(e){}
        fail();
        return;
      }
      if(p&&p.catch) p.catch(function(){
        if(voiceAudio===audio) voiceAudio=null;
        try{ URL.revokeObjectURL(objUrl); }catch(e){}
        fail();
      });
    }).catch(function(){
      fail();
    });
  }
  function voiceSpeak(text){
    if(!voiceReadAloud) return;
    var plain=voiceStripHtml(text);
    if(!plain) return;
    /* Stop anything currently playing first. A new reply replaces the
       old one, never overlaps it. The count marks this request as the
       newest, so an older request that is still on its way is dropped
       when it arrives instead of playing over this one. */
    voiceStopAudio();
    voiceSpeakSeq++;
    voiceSpeakAzure(plain,voiceSpeakSeq);
  }
  function syncVoiceButtons(){
    var mic=document.getElementById("hc-voice");
    var spk=document.getElementById("hc-speak");
    if(mic){ mic.setAttribute("aria-pressed",voiceListening?"true":"false"); mic.style.background=voiceListening?"#f0dfae":"#0b1a30"; mic.style.color=voiceListening?"#0b1a30":"#fff"; mic.setAttribute("aria-label",voiceRecording?"Stop recording":"Speak instead of typing"); }
    if(spk){ spk.setAttribute("aria-pressed",voiceReadAloud?"true":"false"); spk.style.background=voiceReadAloud?"#f0dfae":"#0b1a30"; spk.style.color=voiceReadAloud?"#0b1a30":"#fff"; }
  }
  function voiceCanRecord(){
    try{
      return !!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder);
    }catch(e){ return false; }
  }
  function voiceReleaseRecStream(){
    if(voiceRecStream){ try{ voiceRecStream.getTracks().forEach(function(t){ try{ t.stop(); }catch(e){} }); }catch(e){} voiceRecStream=null; }
  }
  /* Stop a recording. send=true means transcribe it; send=false discards
     it (panel closed, Escape, or an error). The send flag rides on the
     recorder instance, and the chunks live in that recording's own
     closure, so the onstop handler reads the decision made for it even
     if a new recording starts first. */
  function voiceStopRecording(send){
    if(voiceRecTimer){ clearTimeout(voiceRecTimer); voiceRecTimer=null; }
    var rec=voiceRecorder;
    voiceRecorder=null;
    voiceRecording=false;
    voiceListening=false;
    if(rec){
      rec.__send=!!send;
      if(rec.state&&rec.state!=="inactive"){
        try{ rec.stop(); }catch(e){ voiceReleaseRecStream(); }
      } else {
        voiceReleaseRecStream();
      }
    } else {
      voiceReleaseRecStream();
    }
    syncVoiceButtons();
  }
  function voiceSendRecording(blob){
    say(hcLog(),"Transcribing. One moment.");
    var headers={};
    if(blob.type) headers["Content-Type"]=blob.type;
    fetch(VOICE_TRANSCRIBE_URL,{method:"POST",headers:headers,body:blob}).then(function(r){
      if(!r.ok) throw new Error("transcribe "+r.status);
      return r.json();
    }).then(function(j){
      var text=j&&j.text?String(j.text).trim():"";
      if(!text){ say(hcLog(),"I could not hear anything. Type your question instead."); return; }
      var inp=document.getElementById("hc-q");
      inp.value=text;
      syncInputHeight();
      inp.focus();
    }).catch(function(){
      say(hcLog(),"Voice transcription is not available right now. Type your question instead.");
    });
  }
  function voiceStartRecording(){
    if(!voiceCanRecord()){
      say(hcLog(),"Voice input is not available in this browser. Type your question instead.");
      return;
    }
    var log=hcLog();
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
      voiceRecStream=stream;
      var rec;
      try{ rec=new MediaRecorder(stream); }catch(e){
        voiceReleaseRecStream();
        say(log,"Voice input is not available in this browser. Type your question instead.");
        return;
      }
      voiceRecorder=rec;
      var chunks=[];
      rec.ondataavailable=function(e){
        if(e&&e.data&&e.data.size) chunks.push(e.data);
      };
      rec.onstop=function(){
        var myChunks=chunks.slice();
        voiceReleaseRecStream();
        if(!rec.__send) return;
        if(!myChunks.length){ say(hcLog(),"I could not hear anything. Type your question instead."); return; }
        var blob;
        try{ blob=new Blob(myChunks,{type:rec.mimeType||"audio/mp4"}); }catch(e){ say(hcLog(),"Voice transcription is not available right now. Type your question instead."); return; }
        voiceSendRecording(blob);
      };
      rec.onerror=function(){
        voiceStopRecording(false);
        say(hcLog(),"Voice transcription is not available right now. Type your question instead.");
      };
      try{ rec.start(); }catch(e){
        voiceStopRecording(false);
        say(log,"Voice input is not available in this browser. Type your question instead.");
        return;
      }
      voiceRecording=true;
      voiceListening=true;
      syncVoiceButtons();
      say(log,"Recording. Tap the microphone again to stop. Your voice is transcribed only and never stored.");
      voiceRecTimer=setTimeout(function(){ voiceStopRecording(true); },VOICE_REC_MAX_MS);
    }).catch(function(err){
      var name=err&&err.name?err.name:"";
      if(name==="NotAllowedError"||name==="SecurityError"){
        say(log,"Microphone access was denied. Type your question instead.");
      } else {
        say(log,"Voice input is not available in this browser. Type your question instead.");
      }
    });
  }
  function voiceStopListen(){
    voiceListening=false;
    if(voiceRecording){ voiceStopRecording(false); }
    if(voiceRecog){ try{ voiceRecog.stop(); }catch(e){} voiceRecog=null; }
    syncVoiceButtons();
  }
  function voiceStopAll(){
    voiceStopListen();
    voiceStopAudio();
    voiceSpeakSeq++;
  }
  function voiceToggleListen(){
    if(voiceListening){
      /* Tap again while recording: stop and transcribe. */
      if(voiceRecording){ voiceStopRecording(true); return; }
      voiceStopListen();
      return;
    }
    /* The microphone always records and the recording is transcribed.
       Built-in speech recognition is never used for input: on iOS it
       fails silently (no prompt, immediate error) whenever it exists,
       so the recorder path is the only one. */
    voiceStartRecording();
  }
  function voiceToggleReadAloud(){
    voiceReadAloud=!voiceReadAloud;
    if(!voiceReadAloud){
      voiceStopAudio();
      voiceSpeakSeq++;
    } else {
      /* Turning it on reads the most recent reply at once, inside the
         tap, so the visitor hears something right away instead of
         waiting for the next reply. */
      voiceSpeak(voiceLastAgentText());
    }
    syncVoiceButtons();
  }
  /* Agent with memory: opt-in continuity across visits, stored on the
     visitor's device only. The tracker Companion already has opt-in
     memory; this matches that pattern. Email and phone are never stored. */
  var MEM_KEY="hc-memory-v1";
  var MEM_CONSENT_KEY="hc-memory-consent-v1";
  var memGreeted=false;
  function memRead(){
    try{ var raw=localStorage.getItem(MEM_KEY); return raw?JSON.parse(raw):null; }catch(e){ return null; }
  }
  function memConsent(){
    try{ return localStorage.getItem(MEM_CONSENT_KEY); }catch(e){ return null; }
  }
  function memSave(){
    try{
      localStorage.setItem(MEM_KEY,JSON.stringify({name:bk.name,service:bk.qualService,budget:bk.qualBudget,timeline:bk.qualTimeline,topic:bk.topic,savedAt:new Date().toISOString()}));
      localStorage.setItem(MEM_CONSENT_KEY,"yes");
    }catch(e){}
    syncForgetButton();
  }
  function memForget(){
    try{ localStorage.removeItem(MEM_KEY); localStorage.removeItem(MEM_CONSENT_KEY); }catch(e){}
    syncForgetButton();
  }
  /* Forget command: a typed "forget what you remember about me" (and
     close variants) erases the saved visit and confirms it, instead of
     falling through to the site search. Email and phone are never stored,
     so there is nothing else to erase. */
  function isForget(q){
    if(q.indexOf("forget what you remember")>-1) return true;
    if(q.indexOf("forget me")>-1) return true;
    if(q.indexOf("erase what you remember")>-1) return true;
    if(q.indexOf("forget everything")>-1) return true;
    if(q.indexOf("forget about me")>-1) return true;
    if(q.indexOf("do not remember me")>-1||q.indexOf("don't remember me")>-1) return true;
    if(q.indexOf("forget")>-1&&q.indexOf("remember")>-1) return true;
    return false;
  }
  function doForget(log){
    var had=!!memRead();
    memForget();
    bk.step=null;
    removeChoiceButtons();
    if(had){ say(log,"Forgotten. I have erased what I remembered about you, and I will not remember this visit."); }
    else { say(log,"Forgotten. There was nothing saved to erase, and I will not remember this visit."); }
    syncSendButton();
  }
  function memDecline(){
    try{ localStorage.setItem(MEM_CONSENT_KEY,"no"); }catch(e){}
  }
  function syncForgetButton(){
    var b=document.getElementById("hc-forget");
    if(!b) return;
    b.style.display=memRead()?"inline":"none";
  }
  function renderMemory(log,kind){
    removeChoiceButtons();
    var box=hcChoices();
    var d=document.createElement("div");
    d.innerHTML="<button type='button' data-hc-memory='"+kind+"-yes' style='background:#f0dfae;color:#0b1a30;border:2px solid #0b1a30;border-radius:10px;padding:.7em 1em;margin:6px 6px 6px 0;cursor:pointer;font:inherit;font-weight:700'>Yes</button><button type='button' data-hc-memory='"+kind+"-no' style='background:#fff;color:#0b1a30;border:2px solid #0b1a30;border-radius:10px;padding:.7em 1em;margin:6px 0;cursor:pointer;font:inherit'>No</button>";
    box.appendChild(d);
    box.scrollTop=0;
    scrollLog(log);
  }
  function memResume(log){
    var m=memRead();
    if(!m){ bk.step=null; say(log,"I do not have a past visit saved. What can I help with?"); return; }
    bk.qualService=m.service||"";
    bk.qualBudget=m.budget||"";
    bk.qualTimeline=m.timeline||"";
    bk.qualified=!!(m.service&&m.budget&&m.timeline);
    bk.step="slots";
    say(log,"Picking up where we left off. Here are the open times.");
    bkLoadSlots(log);
  }
  function hcMemoryPick(kind,v){
    var log=hcLog();
    removeChoiceButtons();
    if(kind==="consent"){
      if(v==="yes"){ memSave(); bk.step=null; say(log,"Remembered. Next time I will pick up where we left off."); }
      else { memDecline(); bk.step=null; say(log,"No problem. I will not remember this visit."); }
    } else if(kind==="resume"){
      if(v==="yes"){ memResume(log); }
      else { bk.step=null; say(log,"No problem. What can I help with?"); }
    }
    syncSendButton();
    var inp=document.getElementById("hc-q"); if(inp) inp.focus();
  }
  function memGreet(log){
    if(memGreeted||bk.step) return;
    var m=memRead();
    if(!m||!m.name) return;
    memGreeted=true;
    bk.step="memory-resume";
    say(log,"Welcome back, "+esc(m.name)+". Last time you were looking at "+esc(m.service||"your website")+". Shall I pick up where we left off?");
    renderMemory(log,"resume");
  }
  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function hcLog(){ return document.getElementById("hc-log"); }
  /* Scroll the log to the newest message, but only when the visitor is
     already at (or near) the bottom. Once they scroll up to read, leave
     them there: a forced jump back reads as a blocked scroll window.
     The flag turns back on when they send a message or tap a choice,
     so a reply still comes into view. On iOS Safari a scrollTop set
     while the keyboard is dismissing after a tap can be dropped, leaving
     the newest message below the fold. Re-assert on the next frame and
     after a short delay so the answer is actually visible. */
  var hcStickToBottom=true;
  /* Position check used by the re-asserts below: read where the log
     actually is at that moment, instead of trusting the flag, so a
     scroll-up that lands in the same frame as a reply can never be
     dragged back down. */
  function hcNearBottom(log){ return (log.scrollHeight-log.scrollTop-log.clientHeight)<80; }
  function scrollLog(log){
    if(!hcStickToBottom) return;
    log.scrollTop=log.scrollHeight;
    requestAnimationFrame(function(){ if(hcNearBottom(log)){ log.scrollTop=log.scrollHeight; } });
    setTimeout(function(){ if(hcNearBottom(log)){ log.scrollTop=log.scrollHeight; } },100);
  }
  /* Typing indicator: a "Typing..." line in the log while the agent waits
     on the endpoint (slots, booking, lookup, cancel), so the visitor is
     not staring at a blank gap. One at a time; hideTyping removes it. */
  function showTyping(log){
    hideTyping(log);
    var d=document.createElement("div");
    d.id="hc-typing";
    d.setAttribute("role","status");
    d.innerHTML="<p style='margin:8px 0;color:#64748b'>Typing...</p>";
    log.appendChild(d);
    scrollLog(log);
  }
  function hideTyping(log){
    var t=document.getElementById("hc-typing");
    if(t) t.remove();
  }
  function say(log,html){
    var d=document.createElement("div");
    d.innerHTML="<p style='margin:8px 0'>"+html+"</p>";
    log.appendChild(d);
    voiceSpeak(html);
    scrollLog(log);
    syncSendButton();
  }
  /* The send button reads Send while the chat is asking a booking
     question and Ask when it is waiting for a question. Every booking
     step change is followed by a say(), so syncing here covers all of them. */
  function syncSendButton(){
    var inp=document.getElementById("hc-q");
    var send=document.getElementById("hc-send");
    var lab=document.querySelector("label[for='hc-q']");
    if(!inp||!send) return;
    var answering=!!bk.step;
    send.textContent=answering?"Send":"Ask";
    inp.placeholder=answering?"Type your answer":"Ask about prices or booking";
    inp.setAttribute("aria-label",answering?"Type your answer":"Ask about prices or booking");
    if(lab) lab.textContent=answering?"Type your answer":"Ask about prices or booking";
  }
  /* The input is a two-line textarea that grows as the visitor types, up
     to five lines, then scrolls. Keeps the typed words visible on a
     narrow phone instead of a cramped single line. */
  function syncInputHeight(){
    var inp=document.getElementById("hc-q");
    if(!inp) return;
    inp.style.height="auto";
    inp.style.height=Math.min(inp.scrollHeight,140)+"px";
  }
  function validEmail(v){ var at=v.indexOf("@"); return at>0 && v.indexOf(".",at)>at+1; }
  function validPhone(v){ return v.replace(/\D/g,"").length>=7; }
  function isYes(q){ return q==="yes"||q==="yeah"||q==="sure"||q==="ok"||q==="okay"||q.indexOf("yes ")===0||q.indexOf("yes,")===0; }
  function isNo(q){ return q==="no"||q==="nope"||q.indexOf("no ")===0||q.indexOf("no,")===0; }
  function isBookIntent(q){
    return q.indexOf("book")>-1||q.indexOf("discovery")>-1||q.indexOf("appointment")>-1||q.indexOf("schedule")>-1||q.indexOf("consultation")>-1;
  }
  function isResched(q){
    return q.indexOf("reschedule")>-1||q.indexOf("move my")>-1||q.indexOf("change my call")>-1||q.indexOf("different time")>-1||q.indexOf("move it")>-1;
  }
  /* Cancel by chat: "cancel my booking", "cancel my call", "I need to
     cancel", and close variants. A bare "cancel" is NOT a match: that is
     the stop command ("Type cancel any time to stop"), handled elsewhere. */
  function isCancelBooking(q){
    if(q.indexOf("cancel my booking")>-1) return true;
    if(q.indexOf("cancel my call")>-1) return true;
    if(q.indexOf("cancel the call")>-1) return true;
    if(q.indexOf("cancel my appointment")>-1) return true;
    if(q.indexOf("cancel the appointment")>-1) return true;
    if(q.indexOf("cancel my session")>-1) return true;
    if(q.indexOf("cancel the session")>-1) return true;
    if(q.indexOf("cancel my meeting")>-1) return true;
    if(q.indexOf("cancel the meeting")>-1) return true;
    if(q.indexOf("cancel my discovery")>-1) return true;
    if(q.indexOf("i need to cancel")>-1) return true;
    if(q.indexOf("i want to cancel")>-1) return true;
    if(q.indexOf("cancel")>-1&&(q.indexOf("booking")>-1||q.indexOf("appointment")>-1)) return true;
    return false;
  }
  /* Leave a message: "leave a message", "leave a note", "message for
     Jessica", and close variants. Starts the message flow from a plain
     question, never from inside another flow. */
  function isLeaveMessage(q){
    if(q.indexOf("leave a message")>-1) return true;
    if(q.indexOf("leave a note")>-1) return true;
    if(q.indexOf("message for jessica")>-1) return true;
    if(q.indexOf("leave her a message")>-1) return true;
    if(q.indexOf("leave a message for")>-1) return true;
    return false;
  }
  /* Leave-a-message flow: name, email, question, then one email to
     Jessica through the notify Worker. Name, email, and question are
     kept in this session only and never saved to the device. */
  var msg={name:"",email:"",question:""};
  function msgStart(log){
    bk.step="msg-name";
    msg={name:"",email:"",question:""};
    say(log,"I will send a message to Jessica. What is your name?");
  }
  function msgSend(log){
    notifyJessica("message",{name:msg.name,email:msg.email,question:msg.question});
    bk.step=null;
    msg={name:"",email:"",question:""};
    say(log,"Your message is sent. Jessica will reply personally within 1 business day.");
    syncSendButton();
  }
  /* Human fallback for validation re-prompts and the reschedule
     not-found message: a stuck visitor can reach a human. */
  var HUMAN_FALLBACK="Or email millrjess@gmail.com / call (978) 267-5304.";
  /* A strategy question ("How much is a strategy session?") gets an
     answer. A strategy intent ("Strategy", "book a strategy session")
     goes through qualification before any payment link is shown. */
  function isStrategyQuestion(q){
    if(q.indexOf("how much")>-1||q.indexOf("cost")>-1||q.indexOf("price")>-1||q.indexOf("fee")>-1||q.indexOf("what is")>-1||q.indexOf("what does")>-1||q.indexOf("how does")>-1||q.indexOf("tell me")>-1) return true;
    if(q.slice(-1)==="?"&&(q.indexOf("what")===0||q.indexOf("how")===0||q.indexOf("why")===0||q.indexOf("when")===0||q.indexOf("where")===0||q.indexOf("is ")===0||q.indexOf("are ")===0||q.indexOf("can ")===0||q.indexOf("do ")===0)) return true;
    return false;
  }
  /* Plain-question free-work detection: "Can you build my website for
     free?", "I want the work itself done for free, with no payment at
     all". Asking whether the discovery call is free is a price question,
     not a free-work ask, so it is excluded. */
  function isFreeWorkAsk(q){
    if(q.indexOf("free")===-1) return false;
    if(q.indexOf("discovery")>-1) return false;
    if(q.indexOf("free work")>-1) return true;
    if(q.indexOf("work for free")>-1) return true;
    if(q.indexOf("do free")>-1) return true;
    if(q.indexOf("for free")>-1){
      if(q.indexOf("build")>-1||q.indexOf("design")>-1||q.indexOf("develop")>-1||q.indexOf("make")>-1||q.indexOf("create")>-1||q.indexOf("do")>-1||q.indexOf("work")>-1||q.indexOf("website")>-1||q.indexOf("site")>-1||q.indexOf("it")>-1||q.indexOf("strategy")>-1) return true;
      return false;
    }
    if(q.indexOf("no payment")>-1||q.indexOf("without pay")>-1||q.indexOf("without payment")>-1||q.indexOf("for nothing")>-1){
      if(q.indexOf("i want")>-1||q.indexOf("i need")>-1||q.indexOf("work")>-1||q.indexOf("build")>-1||q.indexOf("design")>-1||q.indexOf("do it")>-1) return true;
      return false;
    }
    if((q.indexOf("i want")>-1||q.indexOf("can you")>-1||q.indexOf("will you")>-1)&&q.indexOf("work")>-1) return true;
    return false;
  }
  /* Plain-question out-of-scope detection: logo, social media, graphic
     design, copywriting, video editing, photography. Adding an existing
     logo to a website is website work, not logo design. */
  function isOutOfScopeAsk(q){
    if(q.indexOf("logo")>-1){
      if(q.indexOf("on my website")>-1||q.indexOf("on the website")>-1||q.indexOf("to my website")>-1||q.indexOf("add my logo")>-1||q.indexOf("put my logo")>-1||q.indexOf("upload my logo")>-1) return false;
      return true;
    }
    for(var i=1;i<QUAL_OUT_OF_SCOPE.length;i++){
      if(q.indexOf(QUAL_OUT_OF_SCOPE[i])>-1) return true;
    }
    return false;
  }
  /* Strategy booking intent: "book a strategy session", "I want to book
     a strategy session", "How do I book a strategy session?" A plain
     "I want a strategy session" is not a booking intent: it qualifies
     first, as before. */
  function isStrategyBookIntent(q){
    if(q.indexOf("strategy")===-1) return false;
    if(q.indexOf("book")>-1||q.indexOf("schedule")>-1||q.indexOf("pay")>-1||q.indexOf("sign up")>-1||q.indexOf("buy")>-1) return true;
    return false;
  }
  /* A decline of the strategy upsell after a booking: "no thanks",
     "not now", "not interested", "maybe later". isNo covers the bare
     "no" forms; this covers the phrases isNo misses. */
  function isUpsellDecline(q){
    if(q.indexOf("no thanks")>-1||q.indexOf("no thank you")>-1||q.indexOf("not now")>-1||q.indexOf("not right now")>-1||q.indexOf("not interested")>-1||q.indexOf("maybe later")>-1||q.indexOf("later")>-1||q.indexOf("no need")>-1) return true;
    return false;
  }
  /* An email the visitor already gave in this session, from any flow:
     booking, reschedule, or cancel. Reused so they are never asked twice. */
  function sessionEmail(){
    return bk.email||bk.reschedEmail||bk.cancelEmail||"";
  }
  /* After a turn-away, a reply that says the website is the real need
     restarts qualification. A question ("What is in a care plan?") is
     not a need, so it falls through to a normal answer. */
  function isTurnawayWebsiteNeed(q){
    if(q.indexOf("what")===0||q.indexOf("how")===0||q.indexOf("why")===0||q.indexOf("when")===0||q.indexOf("where")===0||q.indexOf("which")===0||q.indexOf("is ")===0||q.indexOf("are ")===0||q.indexOf("can ")===0||q.indexOf("do ")===0||q.indexOf("does ")===0) return false;
    if(isYes(q)||q.indexOf("book")>-1) return true;
    if(q.indexOf("my website")>-1||q.indexOf("my site")>-1||q.indexOf("website needs")>-1||q.indexOf("site needs")>-1||q.indexOf("needs care")>-1||q.indexOf("care plan")>-1||q.indexOf("i need")>-1) return true;
    return qualTextService(q)>-1;
  }
  function bkReset(){ bk.step=null; bk.name=""; bk.phone=""; bk.website=""; bk.topic=""; bk.slots=[]; bk.slot=null; bk.reschedEmail=""; bk.cancelEmail=""; bk.cancelLabel=""; bk.qualService=""; bk.qualBudget=""; bk.qualTimeline=""; bk.qualOther=""; bk.qualified=false; removeChoiceButtons(); }
  function bkGet(url,cb){
    fetch(url).then(function(r){ return r.json(); }).then(function(j){ cb(j); }).catch(function(){ cb(null); });
  }
  function bkPost(data,cb){
    fetch(BOOKING_ENDPOINT,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(data)}).then(function(r){ return r.json(); }).then(function(j){ cb(j); }).catch(function(){ cb(null); });
  }
  /* Notify Jessica by email through the notify Worker: a booked call, a
     message left for her, or a question the agent could not answer.
     Fire and forget: a failed notify never changes what the visitor
     sees, and a booking is already recorded by the booking endpoint. */
  function notifyJessica(type,data){
    var body={type:type};
    if(data){ for(var k in data){ if(data.hasOwnProperty(k)) body[k]=data[k]; } }
    try{
      fetch(NOTIFY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).catch(function(){});
    }catch(e){}
  }
  /* Choice buttons live in their own container below the log and after
     the input in DOM order, so forward Tab reaches them. A picked set is
     removed from the panel instead of left faded and dead. A keyboard
     user on a button that is removed gets focus back in the input. */
  function hcChoices(){ return document.getElementById("hc-choices"); }
  function removeChoiceButtons(){
    var box=hcChoices();
    if(!box) return;
    var old=box.querySelectorAll("button[data-hc-slot],button[data-hc-confirm],button[data-hc-qual],button[data-hc-memory]");
    var focused=document.activeElement;
    var focusLost=false;
    for(var i=0;i<old.length;i++){ if(old[i]===focused) focusLost=true; old[i].remove(); }
    if(focusLost){ var inp=document.getElementById("hc-q"); if(inp) inp.focus(); }
  }
  function renderSlots(log,slots){
    removeChoiceButtons();
    var box=hcChoices();
    var d=document.createElement("div");
    var html="";
    for(var i=0;i<slots.length;i++){
      html+="<button type='button' data-hc-slot='"+i+"' style='display:block;width:100%;text-align:left;background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.7em .9em;margin:6px 0;cursor:pointer;font:inherit'>"+esc(slots[i].label)+"</button>";
    }
    d.innerHTML=html;
    box.appendChild(d);
    box.scrollTop=0;
    scrollLog(log);
  }
  function renderConfirm(log,yesLabel,noLabel){
    removeChoiceButtons();
    var box=hcChoices();
    var d=document.createElement("div");
    d.innerHTML="<button type='button' data-hc-confirm='yes' style='background:#f0dfae;color:#0b1a30;border:2px solid #0b1a30;border-radius:10px;padding:.7em 1em;margin:6px 6px 6px 0;cursor:pointer;font:inherit;font-weight:700'>"+yesLabel+"</button><button type='button' data-hc-confirm='no' style='background:#fff;color:#0b1a30;border:2px solid #0b1a30;border-radius:10px;padding:.7em 1em;margin:6px 0;cursor:pointer;font:inherit'>"+(noLabel||"No, pick another time")+"</button>";
    box.appendChild(d);
    box.scrollTop=0;
    scrollLog(log);
  }
  /* Lead qualification: four questions before the booking flow.
     Service, budget, timeline, website. Pass or fail by her published
     prices. Runs entirely in the chat. No endpoint change. */
  var PRICING_PAGE="../pricing/";
  var QUAL_SERVICE=["Care plan","Site Health Audit","Technical SEO","Accessibility","New site or app","Website agent","Strategy session","Something else"];
  var QUAL_BUDGET=["Under $500","$500 to $1,500","$1,500 to $5,000","Over $5,000","Not sure yet","I need it free"];
  var QUAL_TIMELINE=["This month","Next month or two","No rush","Just exploring"];
  var QUAL_ONE_TIME=["Site Health Audit","Technical SEO","Accessibility","New site or app","Website agent"];
  var QUAL_OUT_OF_SCOPE=["logo","social media","graphic design","copywriting","video editing","photography"];
  function qualIsOneTime(s){ return QUAL_ONE_TIME.indexOf(s)>-1; }
  function renderQual(log,group,options){
    removeChoiceButtons();
    var box=hcChoices();
    var d=document.createElement("div");
    var html="";
    for(var i=0;i<options.length;i++){
      html+="<button type='button' data-hc-qual='"+group+":"+i+"' style='display:block;width:100%;text-align:left;background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.7em .9em;margin:6px 0;cursor:pointer;font:inherit'>"+esc(options[i])+"</button>";
    }
    d.innerHTML=html;
    box.appendChild(d);
    box.scrollTop=0;
    scrollLog(log);
  }
  function qualEcho(log,text){
    var d=document.createElement("div");
    d.innerHTML="<p style='margin:8px 0'><strong>You:</strong> "+esc(text)+"</p>";
    log.appendChild(d);
    scrollLog(log);
  }
  function qualBudgetTurnAway(log,free){
    bkReset();
    if(free){ say(log,"I do not do free work. My prices are on the <a href='"+PRICING_PAGE+"'>pricing page</a>."); }
    else { say(log,"One time work starts at $500. That is the floor for an audit, SEO, accessibility, or a new site or app."); }
    say(log,"A care plan starts at $150 a month. A 1-hour strategy session is $200. <a href='"+PRICING_PAGE+"'>Pricing</a> or <a href='"+STRIPE_STRATEGY_URL+"'>pay on Stripe</a>.");
    /* The visitor can still come back: a reply that says the website is
       the real need restarts qualification instead of hitting the fallback. */
    bk.step="turnaway";
    syncSendButton();
  }
  function qualScopeTurnAway(log){
    bkReset();
    say(log,"I do website work. That request is outside it. Prices are on the <a href='"+PRICING_PAGE+"'>pricing page</a>.");
    say(log,"If your website is the real need, say so and I can book a call.");
    bk.step="turnaway";
    syncSendButton();
  }
  /* Send a visitor to pay for a strategy session: the $200 answer plus
     the clickable Stripe link. Never books a free call, and never wipes
     a booking already made in this session. */
  function strategyRoute(log){
    bk.step=null;
    bk.qualService=""; bk.qualBudget=""; bk.qualTimeline=""; bk.qualOther=""; bk.qualified=false;
    removeChoiceButtons();
    say(log,find("strategy session"));
    say(log,"Pay for a 1-hour strategy session here: <a href='"+STRIPE_STRATEGY_URL+"'>Stripe payment link</a>.");
    syncSendButton();
  }
  /* A strategy price question gets the $200 answer plus the Stripe link,
     so the visitor does not have to ask twice. Other strategy questions
     get the answer alone. */
  function sayStrategyPrice(log,q){
    say(log,find(q));
    if(q.indexOf("how much")>-1||q.indexOf("cost")>-1||q.indexOf("price")>-1||q.indexOf("fee")>-1||q.indexOf("pay")>-1){
      say(log,"Pay for a 1-hour strategy session here: <a href='"+STRIPE_STRATEGY_URL+"'>Stripe payment link</a>.");
    }
  }
  /* After the strategy upsell is settled, ask the memory question on its
     own, so a Yes or No answers exactly one question. Only asked when
     no consent is recorded yet. */
  function askMemoryAfterBooking(log){
    if(!memConsent()){
      bk.step="memory-consent";
      say(log,"Would you like me to remember this visit, so next time I can pick up where we left off? You can forget it any time.");
      renderMemory(log,"consent");
    } else {
      bk.step=null;
      syncSendButton();
    }
  }
  function qualStart(log){
    bk.step="qual-service";
    say(log,"What do you need help with?");
    renderQual(log,"service",QUAL_SERVICE);
  }
  function qualServicePick(log,i,echo){
    var label=QUAL_SERVICE[i];
    if(!label) return;
    /* Typed answers are already echoed by ask(); only echo here for a
       button tap, so a typed answer that matches a button appears once. */
    if(echo!==false) qualEcho(log,label);
    if(label==="Strategy session"){
      bkReset();
      say(log,find("strategy session"));
      say(log,"Pay for a 1-hour strategy session here: <a href='"+STRIPE_STRATEGY_URL+"'>Stripe payment link</a>.");
      return;
    }
    bk.qualService=label;
    if(label==="Something else"){
      bk.step="qual-other";
      say(log,"What do you need help with?");
      return;
    }
    bk.step="qual-budget";
    say(log,"What is your budget?");
    renderQual(log,"budget",QUAL_BUDGET);
  }
  function qualBudgetPick(log,i,echo){
    var label=QUAL_BUDGET[i];
    if(!label) return;
    if(echo!==false) qualEcho(log,label);
    if(label==="I need it free"){ qualBudgetTurnAway(log,true); return; }
    if(label==="Under $500"&&qualIsOneTime(bk.qualService)){ qualBudgetTurnAway(log,false); return; }
    bk.qualBudget=label;
    bk.step="qual-timeline";
    say(log,"When do you need it?");
    renderQual(log,"timeline",QUAL_TIMELINE);
  }
  function qualTimelinePick(log,i,echo){
    var label=QUAL_TIMELINE[i];
    if(!label) return;
    if(echo!==false) qualEcho(log,label);
    bk.qualTimeline=label;
    bk.qualified=true;
    /* Open times come next, before any contact details, so the visitor
       sees value before being asked for name, email, and phone. */
    bk.step="slots";
    bkLoadSlots(log);
  }
  function hcQualPick(group,i){
    var log=hcLog();
    removeChoiceButtons();
    if(group==="service"&&bk.step==="qual-service"){ qualServicePick(log,i); }
    else if(group==="budget"&&bk.step==="qual-budget"){ qualBudgetPick(log,i); }
    else if(group==="timeline"&&bk.step==="qual-timeline"){ qualTimelinePick(log,i); }
    else { return; }
    /* A pick that leads to a typed question (timeline to website, service
       to "something else") renders no buttons, so focus would stay on the
       picked button and typed keys would go nowhere. Put focus in the input. */
    var inp=document.getElementById("hc-q"); if(inp) inp.focus();
  }
  function qualTextService(q){
    if(q.indexOf("care")>-1||q.indexOf("maintenance")>-1) return 0;
    if(q.indexOf("audit")>-1||q.indexOf("health")>-1) return 1;
    if(q.indexOf("seo")>-1) return 2;
    if(q.indexOf("accessib")>-1||q.indexOf("wcag")>-1) return 3;
    if(q.indexOf("new site")>-1||q.indexOf("new website")>-1||q.indexOf("new app")>-1) return 4;
    if(q.indexOf("agent")>-1||q.indexOf("automat")>-1) return 5;
    if(q.indexOf("strategy")>-1) return 6;
    if(q.indexOf("something else")>-1||q.indexOf("other")>-1||q.indexOf("else")>-1) return 7;
    return -1;
  }
  function qualTextBudget(q){
    if(q.indexOf("free")>-1) return 5;
    if(q.indexOf("not sure")>-1||q.indexOf("unsure")>-1||q.indexOf("do not know")>-1||q.indexOf("don't know")>-1) return 4;
    if(q.indexOf("under")>-1||q.indexOf("less than")>-1) return 0;
    if(q.indexOf("over")>-1||q.indexOf("more than")>-1||q.indexOf("5000")>-1||q.indexOf("5,000")>-1) return 3;
    if(q.indexOf("1500")>-1||q.indexOf("1,500")>-1) return 2;
    if(q.indexOf("500")>-1) return 1;
    return -1;
  }
  function qualTextTimeline(q){
    if(q.indexOf("this month")>-1) return 0;
    if(q.indexOf("next month")>-1) return 1;
    if(q.indexOf("no rush")>-1) return 2;
    if(q.indexOf("explor")>-1) return 3;
    return -1;
  }
  function qualFoldTopic(topic){
    if(!bk.qualified) return topic;
    var service=bk.qualService;
    if(service==="Something else"&&bk.qualOther) service="Something else: "+bk.qualOther;
    return "Service: "+service+". Budget: "+bk.qualBudget+". Timeline: "+bk.qualTimeline+". Topic: "+topic;
  }
  function bkLoadSlots(log){
    showTyping(log);
    bkGet(BOOKING_ENDPOINT+"?action=slots",function(res){
      hideTyping(log);
      if(!res||!res.success){ bkReset(); say(log,"Something went wrong. Please try again, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
      if(!res.slots||!res.slots.length){
        bkReset();
        say(log,"There are no open times in the next two weeks.");
        say(log,"You can book on the <a href='"+BOOKING_PAGE+"'>booking page</a>, email millrjess@gmail.com, or call (978) 267-5304.");
        return;
      }
      bk.slots=res.slots;
      say(log,"Here are the open times. Pick one:");
      renderSlots(log,res.slots);
    });
  }
  function bkDoBook(log){
    say(log,"Booking your call. One moment.");
    showTyping(log);
    bkPost({action:"book",name:bk.name,email:bk.email,phone:bk.phone,website:bk.website,topic:bk.topic,start:bk.slot.start},function(res){
      hideTyping(log);
      if(res&&res.success){
        bk.booked=true;
        bk.eventLabel=res.label||bk.slot.label;
        notifyJessica("booking",{name:bk.name,email:bk.email,phone:bk.phone,website:bk.website,topic:bk.topic,slot:bk.eventLabel,service:bk.qualService,budget:bk.qualBudget,timeline:bk.qualTimeline});
        bk.step=null;
        removeChoiceButtons();
        say(log,"You are booked for "+esc(bk.eventLabel)+". Jessica will call you at "+esc(bk.phone)+".");
        /* The strategy upsell is its own question, answered first. The
           memory question follows only after the upsell is settled, so
           one Yes or No never answers two questions at once. */
        bk.step="upsell-strategy";
        say(log,"Would you like a 1-hour strategy session next? It is $200, paid at booking through Stripe. <a href='"+BOOKING_PAGE+"'>Booking page</a> or <a href='"+STRIPE_STRATEGY_URL+"'>pay on Stripe</a>.");
      } else {
        say(log,esc(res&&res.message?res.message:"Something went wrong. Please try again."));
        bk.step="slots";
        bkLoadSlots(log);
      }
    });
  }
  function bkDoReschedule(log){
    say(log,"Moving your call. One moment.");
    showTyping(log);
    var email=bk.booked?bk.email:bk.reschedEmail;
    bkPost({action:"reschedule",email:email,start:bk.slot.start},function(res){
      hideTyping(log);
      if(res&&res.success){
        bk.eventLabel=res.label||bk.slot.label;
        bk.step=null;
        removeChoiceButtons();
        say(log,"Your call moved to "+esc(bk.eventLabel)+".");
      } else {
        var msg=res&&res.message?res.message:"Something went wrong. Please try again.";
        if(msg.indexOf("could not find a booking")>-1){
          /* No booking for that email. Do not send the visitor back to
             pick times for a dead email: say so at once, with the human
             fallback, and ask for the email again. */
          bk.step="resched-email";
          say(log,esc(msg)+" Or call (978) 267-5304.");
          say(log,"What email did you book with?");
        } else {
          say(log,esc(msg));
          bk.step="resched-slots";
          bkLoadSlots(log);
        }
      }
    });
  }
  /* Look a booking up by email for a reschedule. Restates the current
     booking, then loads the open times; the slot prompt comes once, from
     bkLoadSlots. */
  function doReschedLookup(log,email){
    bk.reschedEmail=email;
    bk.step="resched-lookup";
    say(log,"Looking up your booking. One moment.");
    showTyping(log);
    bkPost({action:"lookup",email:bk.reschedEmail},function(res){
      hideTyping(log);
      if(res&&res.success&&res.found){
        say(log,"Your call is currently "+esc(res.label)+".");
        bk.step="resched-slots"; bkLoadSlots(log);
      } else {
        var msg=res&&res.message?res.message:"I could not find a booking for that email in the next two weeks.";
        say(log,esc(msg)+" Or call (978) 267-5304.");
        say(log,"What email did you book with?");
        bk.step="resched-email";
      }
    });
  }
  /* Look a booking up by email for a cancel. On a match, asks for a
     clear confirmation; on no match, says so plainly and never restarts
     the booking pitch. */
  function doCancelLookup(log,email){
    bk.cancelEmail=email;
    bk.step="cancel-lookup";
    say(log,"Looking up your booking. One moment.");
    showTyping(log);
    bkPost({action:"lookup",email:bk.cancelEmail},function(res){
      hideTyping(log);
      if(res&&res.success&&res.found){
        bk.cancelLabel=res.label;
        bk.step="cancel-confirm";
        say(log,"Your call is booked for "+esc(res.label)+". Shall I cancel it?");
        renderConfirm(log,"Yes, cancel it","No, keep my call");
      } else {
        var msg=res&&res.message?res.message:"I could not find a booking for that email in the next two weeks.";
        bk.step=null;
        say(log,esc(msg)+" You can book a new call on the <a href='"+BOOKING_PAGE+"'>booking page</a>, email millrjess@gmail.com, or call (978) 267-5304.");
      }
      syncSendButton();
    });
  }
  /* Cancel by chat: find the booking by email (the same lookup the
     reschedule pre-check uses), ask for a clear confirmation, then
     delete the one matching event. A not-found answer says so plainly
     and never restarts the booking pitch. */
  function startCancel(log){
    if(bk.booked&&bk.email&&bk.eventLabel){
      bk.cancelEmail=bk.email;
      bk.cancelLabel=bk.eventLabel;
      bk.step="cancel-confirm";
      say(log,"Your call is booked for "+esc(bk.cancelLabel)+". Shall I cancel it?");
      renderConfirm(log,"Yes, cancel it","No, keep my call");
      return;
    }
    /* An email already given in this session (a reschedule, or a booking
       that did not finish) is reused, not asked for again. */
    if(sessionEmail()){
      doCancelLookup(log,sessionEmail());
      return;
    }
    bk.step="cancel-email";
    say(log,"I can cancel your Free 15-Minute Discovery Call. What email did you book with?");
  }
  function bkDoCancel(log){
    say(log,"Cancelling your call. One moment.");
    showTyping(log);
    bkPost({action:"cancel",email:bk.cancelEmail},function(res){
      hideTyping(log);
      if(res&&res.success){
        bk.booked=false;
        bk.eventLabel="";
        bk.step=null;
        removeChoiceButtons();
        say(log,"Your call on "+esc(res.label||bk.cancelLabel)+" is cancelled.");
      } else {
        var msg=res&&res.message?res.message:"Something went wrong. Please try again.";
        bk.step=null;
        removeChoiceButtons();
        say(log,esc(msg)+" You can book a new call on the <a href='"+BOOKING_PAGE+"'>booking page</a>, email millrjess@gmail.com, or call (978) 267-5304.");
      }
      syncSendButton();
    });
  }
  function hcSlotPick(i){
    var log=hcLog();
    if(bk.step!=="slots"&&bk.step!=="resched-slots") return;
    var slot=bk.slots[i];
    if(!slot) return;
    removeChoiceButtons();
    bk.slot=slot;
    if(bk.step==="slots"){
      if(bk.name&&bk.email&&bk.phone){
        /* Contact details are already collected, after a failed booking
           or a "No" at confirm. Go straight to the repeat-back. */
        bk.step="confirm";
        say(log,"You picked "+esc(slot.label)+". Jessica will call "+esc(bk.phone)+". Shall I book it?");
        renderConfirm(log,"Yes, book it");
      } else {
        bk.step="name";
        say(log,"You picked "+esc(slot.label)+". What is your name?");
      }
    } else {
      say(log,"You picked "+esc(slot.label)+". Shall I move your call to this time?");
      bk.step="resched-confirm";
      renderConfirm(log,"Yes, move it");
    }
  }
  function hcConfirm(v){
    var log=hcLog();
    removeChoiceButtons();
    if(bk.step==="msg-offer"){
      if(v==="yes"){ msgStart(log); return; }
      bk.step=null;
      say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>.");
      syncSendButton();
      return;
    }
    if(bk.step==="confirm"){
      if(v==="yes"){ bkDoBook(log); return; }
      bk.step="slots";
      say(log,"Here are the open times. Pick one:");
      renderSlots(log,bk.slots);
      return;
    }
    if(bk.step==="resched-confirm"){
      if(v==="yes"){ bkDoReschedule(log); return; }
      bk.step="resched-slots";
      say(log,"Here are the open times. Pick one:");
      renderSlots(log,bk.slots);
      return;
    }
    if(bk.step==="cancel-confirm"){
      if(v==="yes"){ bkDoCancel(log); return; }
      bk.step=null;
      say(log,"No problem. Your call is still booked for "+esc(bk.cancelLabel||"the time you picked")+".");
      return;
    }
  }
  function bkHandle(q,raw,log){
    if(q==="cancel"||q==="stop"){ bkReset(); say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
    if(bk.step==="msg-offer"){
      if(isYes(q)){ msgStart(log); return; }
      if(isNo(q)){ bk.step=null; say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); syncSendButton(); return; }
      say(log,"Tap Yes to leave a message, or No to skip it.");
      return;
    }
    if(bk.step==="msg-name"){ msg.name=raw; bk.step="msg-email"; say(log,"What email should Jessica reply to?"); return; }
    if(bk.step==="msg-email"){
      if(!validEmail(raw)){ say(log,"That email does not look right. What email should Jessica reply to? "+HUMAN_FALLBACK); return; }
      msg.email=raw; bk.step="msg-question"; say(log,"What is your question?"); return;
    }
    if(bk.step==="msg-question"){
      if(!raw){ say(log,"Type your question, and I will send it to Jessica."); return; }
      msg.question=raw;
      msgSend(log);
      return;
    }
    if(bk.step==="memory-consent"){
      if(isYes(q)){ memSave(); bk.step=null; say(log,"Remembered. Next time I will pick up where we left off."); syncSendButton(); return; }
      if(isNo(q)){ memDecline(); bk.step=null; say(log,"No problem. I will not remember this visit."); syncSendButton(); return; }
      say(log,"Tap Yes to remember this visit, or No to forget it.");
      return;
    }
    if(bk.step==="memory-resume"){
      if(isYes(q)){ memResume(log); return; }
      if(isNo(q)){ bk.step=null; say(log,"No problem. What can I help with?"); syncSendButton(); return; }
      say(log,"Tap Yes to pick up where we left off, or No to start fresh.");
      return;
    }
    if(bk.step==="upsell-strategy"){
      if(isNo(q)||isUpsellDecline(q)){
        say(log,"No problem.");
        askMemoryAfterBooking(log);
        return;
      }
      if(isStrategyQuestion(q)){
        sayStrategyPrice(log,q);
        say(log,"Would you like a 1-hour strategy session next?");
        return;
      }
      if(isYes(q)||isStrategyBookIntent(q)||q.indexOf("strategy")>-1){
        strategyRoute(log);
        askMemoryAfterBooking(log);
        return;
      }
      say(log,"Tap Yes for a strategy session, or No to skip it.");
      return;
    }
    if(bk.step==="offer"){
      if(isStrategyBookIntent(q)){ strategyRoute(log); return; }
      if(q.indexOf("strategy")>-1){
        if(isStrategyQuestion(q)){ bkReset(); sayStrategyPrice(log,q); return; }
        qualStart(log);
        return;
      }
      if(isYes(q)||q.indexOf("book")>-1){
        if(!BOOKING_ENDPOINT){ say(log,"Booking in the chat is not set up yet. Please use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); bkReset(); return; }
        qualStart(log);
        return;
      }
      bkReset();
      say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>.");
      return;
    }
    if(bk.step==="name"){ bk.name=raw; bk.step="email"; say(log,"What email should I use?"); return; }
    if(bk.step==="email"){
      if(!validEmail(raw)){ proactiveFormError("email"); say(log,"That email does not look right. What email should I use? "+HUMAN_FALLBACK); return; }
      proactiveFormPassed("email");
      bk.email=raw; bk.step="phone"; say(log,"What phone number should Jessica call?"); return;
    }
    if(bk.step==="phone"){
      if(!validPhone(raw)){ proactiveFormError("phone"); say(log,"That phone number does not look right. What phone number should Jessica call? "+HUMAN_FALLBACK); return; }
      proactiveFormPassed("phone");
      bk.phone=raw;
      bk.step="website"; say(log,"What is your website? Type skip if you do not have one."); return;
    }
    if(bk.step==="website"){
      if(q==="skip"||q==="none"||q==="no"||q==="no website"){ bk.website=""; }
      else if(/\S+\.\S{2,}/.test(raw)){ bk.website=raw; }
      else { proactiveFormError("website"); say(log,"That does not look like a website address. Please type the address, like example.com, or type skip."); return; }
      proactiveFormPassed("website");
      bk.step="topic"; say(log,"What do you want help with?"); return;
    }
    if(bk.step==="topic"){
      bk.topic=qualFoldTopic(raw);
      if(!bk.slot){ bk.step="slots"; bkLoadSlots(log); return; }
      bk.step="confirm";
      say(log,"You picked "+esc(bk.slot.label)+". Jessica will call "+esc(bk.phone)+". Shall I book it?");
      renderConfirm(log,"Yes, book it");
      return;
    }
    if(bk.step==="qual-service"){
      if(isOutOfScopeAsk(q)){ qualScopeTurnAway(log); return; }
      if(isFreeWorkAsk(q)){ qualBudgetTurnAway(log,true); return; }
      var si=qualTextService(q);
      if(si>-1){ qualServicePick(log,si,false); return; }
      say(log,"Please tap one of the choices above, or type what you need.");
      return;
    }
    if(bk.step==="qual-other"){
      if(isFreeWorkAsk(q)){ qualBudgetTurnAway(log,true); return; }
      var low=raw.toLowerCase();
      for(var i=0;i<QUAL_OUT_OF_SCOPE.length;i++){
        if(low.indexOf(QUAL_OUT_OF_SCOPE[i])>-1){ qualScopeTurnAway(log); return; }
      }
      bk.qualOther=raw;
      bk.step="qual-budget";
      say(log,"What is your budget?");
      renderQual(log,"budget",QUAL_BUDGET);
      return;
    }
    if(bk.step==="qual-budget"){
      var bi=qualTextBudget(q);
      if(bi>-1){ qualBudgetPick(log,bi,false); return; }
      say(log,"Please tap one of the choices above, or type your budget.");
      return;
    }
    if(bk.step==="qual-timeline"){
      var ti=qualTextTimeline(q);
      if(ti>-1){ qualTimelinePick(log,ti,false); return; }
      say(log,"Please tap one of the choices above, or type when you need it.");
      return;
    }
    if(bk.step==="slots"){ say(log,"Please tap one of the times above."); return; }
    if(bk.step==="confirm"){
      if(isYes(q)){ bkDoBook(log); return; }
      if(isNo(q)){ bk.step="slots"; say(log,"Here are the open times. Pick one:"); renderSlots(log,bk.slots); return; }
      say(log,"Please tap Yes or No, or type yes or no.");
      return;
    }
    if(bk.step==="resched-email"){
      if(!validEmail(raw)){ say(log,"That email does not look right. What email did you book with? "+HUMAN_FALLBACK); return; }
      doReschedLookup(log,raw);
      return;
    }
    if(bk.step==="resched-lookup"){ say(log,"Looking up your booking. One moment."); return; }
    if(bk.step==="resched-slots"){ say(log,"Please tap one of the times above."); return; }
    if(bk.step==="resched-confirm"){
      if(isYes(q)){ bkDoReschedule(log); return; }
      if(isNo(q)){ bk.step="resched-slots"; say(log,"Here are the open times. Pick one:"); renderSlots(log,bk.slots); return; }
      say(log,"Please tap Yes or No, or type yes or no.");
      return;
    }
    if(bk.step==="cancel-email"){
      if(!validEmail(raw)){ say(log,"That email does not look right. What email did you book with? "+HUMAN_FALLBACK); return; }
      doCancelLookup(log,raw);
      return;
    }
    if(bk.step==="cancel-lookup"){ say(log,"Looking up your booking. One moment."); return; }
    if(bk.step==="cancel-confirm"){
      if(isYes(q)){ bkDoCancel(log); return; }
      if(isNo(q)){ bk.step=null; say(log,"No problem. Your call is still booked for "+esc(bk.cancelLabel||"the time you picked")+"."); return; }
      say(log,"Please tap Yes or No, or type yes or no.");
      return;
    }
  }
  var btn=document.createElement("button");
  btn.id="hc-toggle";
  btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  btn.setAttribute("aria-label","Website agent");
  btn.setAttribute("aria-expanded","false");
  btn.style.cssText="position:fixed;outline-offset:2px;right:20px;bottom:20px;z-index:100;background:#f0dfae;color:#0b1a30;border:2px solid #0b1a30;border-radius:50%;width:56px;height:56px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 22px -8px rgba(15,35,64,.35);font-family:inherit;padding:0";
  var panel=document.createElement("div");
  panel.setAttribute("role","dialog");
  panel.setAttribute("aria-labelledby","hc-title");
  panel.style.cssText="display:none;flex-direction:column;box-sizing:border-box;position:fixed;right:20px;bottom:88px;z-index:100;width:400px;max-width:calc(100vw - 40px);max-height:calc(100vh - 110px);max-height:calc(100dvh - 110px);overflow:hidden;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 14px 34px -18px rgba(15,35,64,.22);padding:16px;font-family:inherit;color:#334155";
  panel.innerHTML="<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:12px;order:1;flex-shrink:0'><p id='hc-title' style='margin:0;color:#0f2340;font-weight:700'>Website agent</p><button id='hc-close' aria-label='Close website agent (X)' style='background:#f0dfae;border:2px solid #0b1a30;border-radius:999px;font-size:1em;font-weight:700;line-height:1;cursor:pointer;color:#0b1a30;padding:.25em .5em;min-width:32px;min-height:32px'>X</button></div><p style='margin:0 0 12px;font-size:.9em;order:2;flex-shrink:0'>I am Jessica's website agent. Ask me anything, book a free call, or leave a message. Only Jessica confirms a session or a price.</p><div id='hc-log' aria-live='polite' role='status' style='font-size:.95em;flex:1 1 auto;min-height:0;max-height:300px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;order:3'></div><div style='display:flex;gap:6px;margin-top:12px;align-items:flex-end;order:5;flex-shrink:0'><label for='hc-q' style='position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)'>Ask about prices, booking, or search the site</label><textarea id='hc-q' rows='2' aria-label='Ask about prices, booking, or search the site' placeholder='Ask about prices, booking, or search the site' style='flex:1;min-width:0;padding:.8em;border:1px solid #e2e8f0;border-radius:10px;font:inherit;font-size:1em;line-height:1.4;box-sizing:border-box;resize:none;overflow-y:auto'></textarea><button id='hc-send' style='background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.8em 1.2em;cursor:pointer;font:inherit;height:48px;flex-shrink:0'>Ask</button></div><div style='display:flex;gap:8px;margin-top:8px;align-items:center;order:6;flex-shrink:0'><button id='hc-voice' type='button' aria-label='Speak instead of typing' aria-pressed='false' title='Speak instead of typing. Your voice is transcribed only, never stored.' style='background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.8em;cursor:pointer;font:inherit;height:48px;width:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center'><svg width='20' height='20' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 3-2.54 5.1-5.5 5.1S6 14 6 11H4c0 3.41 2.72 6.23 6 6.72V21h4v-3.28c3.28-.49 6-3.31 6-6.72h-2z'/></svg></button><button id='hc-speak' type='button' aria-label='Read replies aloud' aria-pressed='false' title='Read replies aloud' style='background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.8em;cursor:pointer;font:inherit;height:48px;width:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center'><svg width='20' height='20' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z'/></svg></button><button id='hc-clear' type='button' aria-label='Clear chat' style='flex:1;min-width:0;height:48px;background:#fff;color:#0b1a30;border:2px solid #0b1a30;border-radius:10px;padding:.8em 1em;cursor:pointer;font:inherit;font-weight:700'>Clear chat</button></div><div id='hc-choices' style='order:4;flex-shrink:0;max-height:220px;overflow-y:auto'></div><p style='font-size:.85em;color:#64748b;margin:12px 0 0;order:7;flex-shrink:0'>Try: How much is a strategy session?</p><button id='hc-forget' type='button' style='display:none;font-size:.85em;background:none;border:0;padding:0;margin-top:8px;cursor:pointer;color:#64748b;text-decoration:underline;order:8'>Forget what you remember about me</button>";
  var st=document.createElement("style"); st.textContent="#hc-toggle:focus-visible{outline:3px solid #0b1a30; outline-offset:2px; box-shadow:0 0 0 6px #f0dfae, 0 10px 22px -8px rgba(15,35,64,.35)}@media (max-width:720px){#hc-toggle{right:12px !important;bottom:12px !important;width:48px !important;height:48px !important}#hc-toggle svg{width:22px !important;height:22px !important}#hc-close{min-width:44px !important;min-height:44px !important}.site-footer{padding-bottom:76px}}#hc-q{min-width:0;resize:none;max-height:140px}@media (max-width:480px){#hc-voice,#hc-speak{width:44px !important;height:44px !important;padding:.6em !important}#hc-send{padding:.5em .6em !important}#hc-clear{height:44px !important;padding:.6em .8em !important}}"; document.head.appendChild(st);
  document.body.appendChild(btn); document.body.appendChild(panel);
  /* The log remembers whether the visitor is at the bottom. Scrolling up
     to read sets the flag off, so new replies stop dragging the log down;
     scrolling back to the bottom turns it on again. */
  var hcLogEl=document.getElementById("hc-log");
  if(hcLogEl){ hcLogEl.addEventListener("scroll",function(){ hcStickToBottom=(hcLogEl.scrollHeight-hcLogEl.scrollTop-hcLogEl.clientHeight)<80; },{passive:true}); }
  /* Choice buttons live in #hc-choices, a sibling of the log, so the
     delegated click listener sits on the panel that holds both. */
  panel.addEventListener("click",function(e){
    var t=e.target;
    while(t&&t!==this){
      if(t.getAttribute){
        var s=t.getAttribute("data-hc-slot");
        if(s!==null){ hcStickToBottom=true; hcSlotPick(Number(s)); return; }
        var c=t.getAttribute("data-hc-confirm");
        if(c!==null){ hcStickToBottom=true; hcConfirm(c); return; }
        var g=t.getAttribute("data-hc-qual");
        if(g!==null){ var parts=g.split(":"); hcStickToBottom=true; hcQualPick(parts[0],Number(parts[1])); return; }
        var m=t.getAttribute("data-hc-memory");
        if(m!==null){ var mp=m.split("-"); hcStickToBottom=true; hcMemoryPick(mp[0],mp[1]); return; }
      }
      t=t.parentNode;
    }
  });
  /* The button stays visible at all times. It used to hide while scrolling,
     but that read as the chat disappearing, so the hide-on-scroll behavior
     was removed. The button is small and sits at the bottom-right corner. */
  function ask(){
    var inp=document.getElementById("hc-q"); var raw=inp.value.trim(); if(!raw) return;
    hcStickToBottom=true;
    var q=raw.toLowerCase();
    var log=document.getElementById("hc-log");
    var d=document.createElement("div"); d.innerHTML="<p style='margin:8px 0'><strong>You:</strong> "+esc(raw)+"</p>"; log.appendChild(d); scrollLog(log); inp.value=""; syncInputHeight();
    if(isForget(q)){ doForget(log); return; }
    if(isCancelBooking(q)){ startCancel(log); return; }
    if(q==="cancel"||q==="stop"){ bkReset(); say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
    /* A reschedule, book, or strategy intent is not trapped by the
       memory question that follows a booking (or a returning-visitor
       greeting). Clear that step and let the normal handler run, so a
       visitor can reschedule right after booking without first
       answering Yes or No. A plain yes or no still answers the memory
       question, and the Yes/No buttons keep working. */
    if((bk.step==="memory-consent"||bk.step==="memory-resume")&&(isResched(q)||isBookIntent(q)||q.indexOf("strategy")>-1)){
      bk.step=null;
      syncSendButton();
    }
    /* A reschedule or a new booking at the strategy upsell is a pivot,
       not an answer to the upsell: clear the step and let the normal
       handler run. A strategy message stays on the upsell. */
    if(bk.step==="upsell-strategy"&&(isResched(q)||(isBookIntent(q)&&q.indexOf("strategy")===-1))){
      bk.step=null;
      syncSendButton();
    }
    if(bk.step==="turnaway"){
      if(q==="cancel"||q==="stop"){ bkReset(); say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
      if(isStrategyBookIntent(q)){ strategyRoute(log); return; }
      if(isTurnawayWebsiteNeed(q)){ qualStart(log); return; }
      bk.step=null;
      syncSendButton();
    }
    if(bk.step){ bkHandle(q,raw,log); return; }
    /* Plain questions are answered directly: an out-of-scope ask and a
       free-work ask get their turn-aways here, not the generic fallback
       and not the discovery-call-is-free line. */
    if(isOutOfScopeAsk(q)){ qualScopeTurnAway(log); return; }
    if(isFreeWorkAsk(q)){ qualBudgetTurnAway(log,true); return; }
    if(q.indexOf("strategy")>-1){
      if(isStrategyBookIntent(q)){ strategyRoute(log); return; }
      if(isStrategyQuestion(q)){ sayStrategyPrice(log,q); return; }
      qualStart(log);
      return;
    }
    if(isResched(q)){
      if(bk.booked&&bk.email){
        say(log,"Your call is currently "+esc(bk.eventLabel)+".");
        bk.step="resched-slots"; bkLoadSlots(log);
      }
      else if(sessionEmail()){ doReschedLookup(log,sessionEmail()); }
      else { bk.step="resched-email"; say(log,"I can move your Free 15-Minute Discovery Call. What email did you book with?"); }
      return;
    }
    /* A search command ("find resume", "show me the tracker") looks the
       page up in the site index first, so a page name is never trapped
       by the booking intent ("fee schedule" contains "schedule") or by
       a loose answer keyword ("fee" in the price answer). If the index
       has no match, the question falls through to the normal answers. */
    if(isSearchCommand(q)){
      var s=siteSearch(stripSearchPrefix(q));
      if(s){ proactiveAnswered(); say(log,s); return; }
    }
    if(isBookIntent(q)){
      if(!BOOKING_ENDPOINT){ say(log,"You can book a Free 15-Minute Discovery Call on the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
      bk.step="offer";
      say(log,BOOK_ANSWER);
      say(log,"Shall I book a Free 15-Minute Discovery Call for you?");
      return;
    }
    if(isLeaveMessage(q)){ msgStart(log); return; }
    var reply=find(q);
    if(reply.indexOf("I do not have a published answer for that.")===0){
      proactiveFallback();
      notifyJessica("unanswered",{question:raw});
      say(log,reply);
      bk.step="msg-offer";
      say(log,"Would you like to leave a message for Jessica? I will send it to her.");
      renderConfirm(log,"Yes, leave a message","No, thanks");
      return;
    }
    proactiveAnswered();
    say(log,reply);
    if(reply===BOOK_ANSWER){
      if(!BOOKING_ENDPOINT) return;
      bk.step="offer";
      say(log,"Shall I book a Free 15-Minute Discovery Call for you?");
    }
  }
  btn.onclick=function(){ var open = panel.style.display==="none"; panel.style.display = open ? "flex" : "none"; btn.setAttribute("aria-expanded", open ? "true" : "false"); if(open){ proactiveChatOpened=true; memGreet(hcLog()); document.getElementById("hc-q").focus(); } else { voiceStopAll(); } };
  document.getElementById("hc-close").onclick=function(){ voiceStopAll(); panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); };
  document.addEventListener("keydown", function(e){ if(e.key==="Escape" && panel.style.display!=="none"){ voiceStopAll(); panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); } });
  /* Focus trap for the chat dialog: Tab and Shift+Tab cycle through the
     focusable controls inside the panel while it is open. The list is
     read on every Tab press, so buttons added later by the chat flow
     are included. The panel is a non-modal dialog, so no modal attribute is
     set and the page behind it stays usable. Escape already closes the
     panel and returns focus to the chat button, as do the close button
     and the toggle. */
  panel.addEventListener("keydown", function(e){
    if(e.key!=="Tab" || panel.style.display==="none") return;
    var focusable=panel.querySelectorAll("a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])");
    var visible=[];
    for(var i=0;i<focusable.length;i++){
      var el=focusable[i];
      if(el.getClientRects().length && getComputedStyle(el).display!=="none" && getComputedStyle(el).visibility!=="hidden") visible.push(el);
    }
    if(!visible.length){ e.preventDefault(); return; }
    var first=visible[0];
    var last=visible[visible.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  });
  /* Clear chat: empties the conversation log and any choice buttons,
     resets the booking state and the input, and announces the clear
     in the log. Saved memory (hc-memory-v1) is untouched. */
  function hcClearChat(){
    bkReset();
    var log=hcLog();
    if(log) log.innerHTML="";
    var box=hcChoices();
    if(box) box.innerHTML="";
    var inp=document.getElementById("hc-q");
    if(inp){ inp.value=""; syncInputHeight(); inp.focus(); }
    syncSendButton();
    if(log) say(log,"Chat cleared.");
  }
  document.getElementById("hc-send").onclick=ask;
  document.getElementById("hc-voice").onclick=voiceToggleListen;
  document.getElementById("hc-speak").onclick=voiceToggleReadAloud;
  document.getElementById("hc-clear").onclick=hcClearChat;
  document.getElementById("hc-forget").onclick=function(){ bkReset(); memForget(); say(hcLog(),"Forgotten. I will not remember this visit."); };
  syncForgetButton();
  document.getElementById("hc-q").addEventListener("keydown", function(e){ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); ask(); } });
  document.getElementById("hc-q").addEventListener("input", syncInputHeight);
  /* Proactive idle trigger: 60 seconds with no activity on the pricing page,
     panel closed, chat never opened this session. Any activity resets it.
     Tests override the delay with window.__hcProactiveIdleMs. */
  (function proactiveArmIdle(){
    if(location.pathname.indexOf("/pricing/")===-1) return;
    var idleMs=(typeof window!=="undefined"&&window.__hcProactiveIdleMs)?window.__hcProactiveIdleMs:PROACTIVE_IDLE_MS;
    var timer=null;
    function reset(){
      if(timer) clearTimeout(timer);
      timer=setTimeout(function(){
        if(panel.style.display==="none"&&!proactiveChatOpened) proactiveOffer("idle",PROACTIVE_IDLE_COPY);
      },idleMs);
    }
    ["mousemove","keydown","touchstart","scroll"].forEach(function(ev){ document.addEventListener(ev,reset,{passive:true}); });
    reset();
  })();
  /* Entry point for the booking page button: open the chat and start the
     booking offer, the same offer the chat gives for "book a discovery call".
     If a booking or qualification is already in progress, just open the panel. */
  window.hcBookCall=function(){
    panel.style.display="flex";
    proactiveChatOpened=true;
    btn.setAttribute("aria-expanded","true");
    var log=hcLog();
    if(bk.step){ document.getElementById("hc-q").focus(); return; }
    if(!BOOKING_ENDPOINT){ say(log,"You can book a Free 15-Minute Discovery Call on the <a href='"+BOOKING_PAGE+"'>booking page</a>."); document.getElementById("hc-q").focus(); return; }
    bk.step="offer";
    say(log,BOOK_ANSWER);
    say(log,"Shall I book a Free 15-Minute Discovery Call for you?");
    document.getElementById("hc-q").focus();
  };
  /* Entry point for the booking page strategy button: open the chat and
     start qualification at the service question. Picking "Strategy session"
     shows the strategy description and the Stripe link, as before, and
     never books. If a booking or qualification is already in progress,
     just open the panel. */
  window.hcStrategy=function(){
    panel.style.display="flex";
    proactiveChatOpened=true;
    btn.setAttribute("aria-expanded","true");
    var log=hcLog();
    if(bk.step){ document.getElementById("hc-q").focus(); return; }
    qualStart(log);
    document.getElementById("hc-q").focus();
  };
  /* Entry point for the home page "How we work together" button: open the
     chat, show the three ways of working together, then start qualification
     at the service question. The step is set before the first say() so the
     Send button reads Send. If a booking or qualification is already in
     progress, just open the panel. */
  window.hcHowWeWork=function(){
    panel.style.display="flex";
    proactiveChatOpened=true;
    btn.setAttribute("aria-expanded","true");
    var log=hcLog();
    if(bk.step){ document.getElementById("hc-q").focus(); return; }
    bk.step="qual-service";
    say(log,HOW_WE_WORK_ANSWER);
    qualStart(log);
    document.getElementById("hc-q").focus();
  };
})();
