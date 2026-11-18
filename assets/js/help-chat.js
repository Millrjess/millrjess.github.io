(function(){
  var BOOKING_ENDPOINT="https://script.google.com/macros/s/AKfycby_8v8seWol3G1XXb9NlamfiYQTKA6Rk9pPHNqss1bTrSx1ONTVlY8BeG0Qg1m4vfKHaA/exec";
  var BOOKING_PAGE="../booking/";
  var STRIPE_STRATEGY_URL="https://buy.stripe.com/aFa7sMfCM43Nc8JdOF6EU02";
  var BOOK_ANSWER="I can book the free 15-minute discovery call right here. It is free, by phone, with no obligation, on a Tuesday or Thursday. A 1-hour strategy session is $200, paid in advance at booking through Stripe.";
  var HOW_WE_WORK_ANSWER="Ongoing care: compare care plans, book a call, then receive onboarding at no extra charge.<br>Projects: choose a service, check its starting price, then book a call.<br>Strategy Session: one hour, $200, payable at booking.";
  var answers=[
    {k:["how we work together","how do we work together","how does this work"],a:HOW_WE_WORK_ANSWER},
    {k:["strategy session","strategy"],a:"A 1-hour strategy session is $200, paid in advance at booking through Stripe, with a receipt. After payment, I will arrange a time with you and confirm every booking personally before it is final. If we cannot find a time that works, you will be refunded."},
    {k:["price","cost","fee","charge","rate"],a:"A 1-hour strategy session is $200, paid in advance. Care plans are $150 per month for Essential and $300 per month for Professional, with two months at no charge when paid annually. One time services start from $500 for a Site Health Audit and from $750 for a Website Standards Pass or a WCAG Accessibility Audit. See the full <a href='../pricing/'>pricing page</a> for every price."},
    {k:["book","consultation","session","appointment"],a:BOOK_ANSWER},
    {k:["free"],a:"The 15-minute discovery call is free, with no charge and no obligation. It is a phone call to discuss your website, your goals, and the problem you want to solve."},
    {k:["200","paid","pay","stripe","refund"],a:"A 1-hour strategy session is $200, paid in advance through Stripe, with a receipt. No session starts until payment is received. After payment, I will arrange a time with you and confirm every booking personally before it is final. If we cannot find a time that works, you will be refunded."},
    {k:["care plan","maintenance","support","monthly"],a:"Essential, $150 per month, includes CMS updates, daily off site backups, uptime monitoring, and a monthly site health report. Professional, $300 per month, adds security hardening and malware scanning, performance checks, one hour of content or design updates, and priority support. See <a href='../pricing/'>Pricing</a>."},
    {k:["audit","health"],a:"A Site Health Audit starts from $500 and reviews technical SEO, security configuration, and website performance, with a prioritized action plan."},
    {k:["seo"],a:"Technical SEO starts from $1,000. Work may include structured data, crawl and indexing fixes, page speed improvements, and GA4 measurement setup. Search rankings are not guaranteed."},
    {k:["accessib","wcag"],a:"A WCAG Accessibility Audit and Remediation starts from $750, with prioritized fixes to meet WCAG 2.1 AA, the legal benchmark version. A Website Standards Pass starts from $750 and corrects against WCAG 2.2 AA, the practice standard."},
    {k:["malware","hacked","security"],a:"Malware Removal and Incident Response starts from $500 per incident, including investigation, cleanup, vulnerability remediation, and security hardening within the agreed scope."},
    {k:["location","where","boston","andover","remote","onsite","zoom"],a:"Based in North Andover, MA 01845, serving Boston, Greater Boston's North Shore, and the Merrimack Valley, plus remote clients nationwide. Sessions are on Zoom, nationwide, and on-site by arrangement in Boston, Greater Boston's North Shore, and the Merrimack Valley, including the Andovers."},
    {k:["wordpress","drupal","joomla","platform"],a:"Ongoing care covers WordPress, Drupal, Joomla, and custom database driven websites."},
    {k:["start","begin","contact","email","phone"],a:"Start on the booking page, or email millrjess@gmail.com, or call (978) 267-5304. I read and reply to every inquiry personally."},
    {k:["website agent","what are you","who are you","can i get one","build me an agent","want an agent","one for my website"],a:"I am Jessica's website agent. She builds agents like me for client websites, starting from $2,500. See <a href='../services/#website-agents'>Website Agents</a>."},
    {k:["agent","website agent","chatbot"],a:"Website Agents start from $2,500, for lead qualification, customer support, data processing, and multi step workflows. Integrations, permitted actions, and human review requirements are defined before development begins."}
  ];

  var siteIndex=[
    {k:["home","consultant","website operations"],u:"../",d:"Home: Jessica A. Miller, Website Operations Consultant, 20 years keeping business websites fast, secure, and online."},
    {k:["service","care plan","maintenance","seo","agent","audit","standards"],u:"../services/",d:"Services: care plans, one time projects, Website Agents, Standards Pass, technical SEO, and performance."},
    {k:["fee","price","pricing","cost"],u:"../pricing/",d:"Pricing: published prices for care plans, audits, development, agents, and strategy sessions, with pricing sources."},
    {k:["book","consultation","discovery","session","appointment"],u:"../booking/",d:"Booking: free 15-minute discovery call, and 1-hour strategy session, $200 paid in advance, approval before confirmation."},
    {k:["contact","email","phone","message"],u:"../contact/",d:"Contact: email millrjess@gmail.com, call (978) 267-5304, North Andover, MA."},
    {k:["faq","question","how"],u:"../faqs/",d:"FAQs: project timing, support, working with a team, prices, booking, refund, care plans, remote work, and platforms."},
    {k:["about","story","background","experience"],u:"../about/",d:"About: 20 years of website work, a six year break for full time parenting and writing, and a return to client work in 2026."},
    {k:["certif","course","credential"],u:"../certifications/",d:"Certifications: 34 course certificates with verification links."},
    {k:["recommend","testimonial","review"],u:"../testimonials/",d:"Testimonials: dated LinkedIn recommendations."},
    {k:["portfolio","project","case study","capstone"],u:"../portfolio/",d:"Work & Credentials: selected work in product, data, and design, plus course certificates and recommendations."},
    {k:["tracker","glp-1","new chapter","app"],u:"../tracker/",d:"New Chapter: GLP-1 Tracker™, an independent product by Jessica, separate from consulting services."},
    {k:["book","ledger","novel","author","fiction"],u:"../books/",d:"Books: The Ledger Series, The Second Account, The Echo Trace, and The Ghost Index."},
    {k:["checkr","background"],u:"https://checkr.com/profiles/jessica-miller-aa27",d:"Checkr public profile: identity verified, Website Operations Consultant, North Andover, MA."}
  ];
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
    for(var i=0;i<answers.length;i++){
      for(var j=0;j<answers[i].k.length;j++){
        if(q.indexOf(answers[i].k[j])>-1) return answers[i].a;
      }
    }
    var s=siteSearch(q); if(s) return s;
    return "I do not have a published answer for that. Please email millrjess@gmail.com, call (978) 267-5304, or use the booking page, and Jessica will reply personally. This chat asks a few questions first, then books a free discovery call or sends you to pay for a strategy session. Only Jessica can confirm a strategy session, change a price, or start work in this chat.";
  }
  /* Booking agent: books the free 15-minute discovery call in the chat.
     The call is free, by phone, Tuesday and Thursday, 10 AM to noon and
     1 to 3 PM Eastern. Strategy sessions are never booked here. */
  var bk={step:null,name:"",email:"",phone:"",website:"",topic:"",slots:[],slot:null,eventLabel:"",reschedEmail:"",booked:false,qualService:"",qualBudget:"",qualTimeline:"",qualOther:"",qualified:false};
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
    bubble.style.cssText="position:fixed;right:20px;bottom:88px;z-index:100;width:300px;max-width:calc(100vw - 40px);background:#fff;border:2px solid #0b1a30;border-radius:12px;box-shadow:0 14px 34px -18px rgba(15,35,64,.22);padding:12px;font-family:inherit;color:#334155";
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
  /* Voice agent: speak instead of type, and hear the replies. Uses the
     browser's built-in speech recognition and speech synthesis. No audio
     is recorded, stored, or sent anywhere. Text stays available always. */
  var voiceListening=false;
  var voiceReadAloud=false;
  var voiceRecog=null;
  function voiceSpeechRecog(){
    return window.SpeechRecognition||window.webkitSpeechRecognition||null;
  }
  function voiceSynth(){
    return window.speechSynthesis||null;
  }
  function voiceStripHtml(html){
    var d=document.createElement("div");
    d.innerHTML=html;
    return (d.textContent||"").replace(/\s+/g," ").trim();
  }
  function voiceSpeak(text){
    if(!voiceReadAloud) return;
    var synth=voiceSynth();
    if(!synth) return;
    var plain=voiceStripHtml(text);
    if(!plain) return;
    try{ synth.cancel(); }catch(e){}
    try{ synth.speak(new SpeechSynthesisUtterance(plain)); }catch(e){}
  }
  function syncVoiceButtons(){
    var mic=document.getElementById("hc-voice");
    var spk=document.getElementById("hc-speak");
    if(mic){ mic.setAttribute("aria-pressed",voiceListening?"true":"false"); mic.style.background=voiceListening?"#f0dfae":"#0b1a30"; mic.style.color=voiceListening?"#0b1a30":"#fff"; }
    if(spk){ spk.setAttribute("aria-pressed",voiceReadAloud?"true":"false"); spk.style.background=voiceReadAloud?"#f0dfae":"#0b1a30"; spk.style.color=voiceReadAloud?"#0b1a30":"#fff"; }
  }
  function voiceStopListen(){
    voiceListening=false;
    if(voiceRecog){ try{ voiceRecog.stop(); }catch(e){} voiceRecog=null; }
    syncVoiceButtons();
  }
  function voiceStopAll(){
    voiceStopListen();
    var synth=voiceSynth();
    if(synth){ try{ synth.cancel(); }catch(e){} }
  }
  function voiceToggleListen(){
    if(voiceListening){ voiceStopListen(); return; }
    var Recog=voiceSpeechRecog();
    if(!Recog){
      say(hcLog(),"Voice input is not available in this browser. Type your question instead.");
      return;
    }
    var recog;
    try{ recog=new Recog(); }catch(e){
      say(hcLog(),"Voice input is not available in this browser. Type your question instead.");
      return;
    }
    recog.lang="en-US";
    recog.interimResults=false;
    recog.maxAlternatives=1;
    voiceRecog=recog;
    voiceListening=true;
    voiceReadAloud=true;
    syncVoiceButtons();
    recog.onresult=function(e){
      var transcript="";
      try{
        for(var i=e.resultIndex;i<e.results.length;i++){
          if(e.results[i].isFinal) transcript+=e.results[i][0].transcript;
        }
      }catch(err){}
      transcript=transcript.trim();
      if(transcript){
        var inp=document.getElementById("hc-q");
        inp.value=transcript;
        ask();
      }
    };
    recog.onerror=function(e){
      voiceStopListen();
      var err=e&&e.error?e.error:"";
      if(err==="not-allowed"||err==="service-not-allowed"||err==="audio-capture"||err==="network"){
        say(hcLog(),"Voice input is not available in this browser. Type your question instead.");
      }
    };
    recog.onend=function(){ voiceStopListen(); };
    try{ recog.start(); }catch(e){ voiceStopListen(); say(hcLog(),"Voice input is not available in this browser. Type your question instead."); }
  }
  function voiceToggleReadAloud(){
    voiceReadAloud=!voiceReadAloud;
    if(!voiceReadAloud){
      var synth=voiceSynth();
      if(synth){ try{ synth.cancel(); }catch(e){} }
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
  /* Scroll the log to the newest message. On iOS Safari a scrollTop set
     while the keyboard is dismissing after a tap can be dropped, leaving
     the newest message below the fold. Re-assert on the next frame and
     after a short delay so the answer is actually visible. */
  function scrollLog(log){
    log.scrollTop=log.scrollHeight;
    requestAnimationFrame(function(){ log.scrollTop=log.scrollHeight; });
    setTimeout(function(){ log.scrollTop=log.scrollHeight; },100);
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
  /* After a turn-away, a reply that says the website is the real need
     restarts qualification. A question ("What is in a care plan?") is
     not a need, so it falls through to a normal answer. */
  function isTurnawayWebsiteNeed(q){
    if(q.indexOf("what")===0||q.indexOf("how")===0||q.indexOf("why")===0||q.indexOf("when")===0||q.indexOf("where")===0||q.indexOf("which")===0||q.indexOf("is ")===0||q.indexOf("are ")===0||q.indexOf("can ")===0||q.indexOf("do ")===0||q.indexOf("does ")===0) return false;
    if(isYes(q)||q.indexOf("book")>-1) return true;
    if(q.indexOf("my website")>-1||q.indexOf("my site")>-1||q.indexOf("website needs")>-1||q.indexOf("site needs")>-1||q.indexOf("needs care")>-1||q.indexOf("care plan")>-1||q.indexOf("i need")>-1) return true;
    return qualTextService(q)>-1;
  }
  function bkReset(){ bk.step=null; bk.name=""; bk.phone=""; bk.website=""; bk.topic=""; bk.slots=[]; bk.slot=null; bk.reschedEmail=""; bk.qualService=""; bk.qualBudget=""; bk.qualTimeline=""; bk.qualOther=""; bk.qualified=false; removeChoiceButtons(); }
  function bkGet(url,cb){
    fetch(url).then(function(r){ return r.json(); }).then(function(j){ cb(j); }).catch(function(){ cb(null); });
  }
  function bkPost(data,cb){
    fetch(BOOKING_ENDPOINT,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(data)}).then(function(r){ return r.json(); }).then(function(j){ cb(j); }).catch(function(){ cb(null); });
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
  function renderConfirm(log,yesLabel){
    removeChoiceButtons();
    var box=hcChoices();
    var d=document.createElement("div");
    d.innerHTML="<button type='button' data-hc-confirm='yes' style='background:#f0dfae;color:#0b1a30;border:2px solid #0b1a30;border-radius:10px;padding:.7em 1em;margin:6px 6px 6px 0;cursor:pointer;font:inherit;font-weight:700'>"+yesLabel+"</button><button type='button' data-hc-confirm='no' style='background:#fff;color:#0b1a30;border:2px solid #0b1a30;border-radius:10px;padding:.7em 1em;margin:6px 0;cursor:pointer;font:inherit'>No, pick another time</button>";
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
  function qualStart(log){
    bk.step="qual-service";
    say(log,"What do you need help with?");
    renderQual(log,"service",QUAL_SERVICE);
  }
  function qualServicePick(log,i){
    var label=QUAL_SERVICE[i];
    if(!label) return;
    qualEcho(log,label);
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
  function qualBudgetPick(log,i){
    var label=QUAL_BUDGET[i];
    if(!label) return;
    qualEcho(log,label);
    if(label==="I need it free"){ qualBudgetTurnAway(log,true); return; }
    if(label==="Under $500"&&qualIsOneTime(bk.qualService)){ qualBudgetTurnAway(log,false); return; }
    bk.qualBudget=label;
    bk.step="qual-timeline";
    say(log,"When do you need it?");
    renderQual(log,"timeline",QUAL_TIMELINE);
  }
  function qualTimelinePick(log,i){
    var label=QUAL_TIMELINE[i];
    if(!label) return;
    qualEcho(log,label);
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
    bkGet(BOOKING_ENDPOINT+"?action=slots",function(res){
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
    bkPost({action:"book",name:bk.name,email:bk.email,phone:bk.phone,website:bk.website,topic:bk.topic,start:bk.slot.start},function(res){
      if(res&&res.success){
        bk.booked=true;
        bk.eventLabel=res.label||bk.slot.label;
        bk.step=null;
        removeChoiceButtons();
        say(log,"You are booked for "+esc(bk.eventLabel)+". Jessica will call you at "+esc(bk.phone)+".");
        say(log,"Would you like a 1-hour strategy session next? It is $200, paid at booking through Stripe. <a href='"+BOOKING_PAGE+"'>Booking page</a> or <a href='"+STRIPE_STRATEGY_URL+"'>pay on Stripe</a>.");
        if(!memConsent()){
          bk.step="memory-consent";
          say(log,"Would you like me to remember this visit, so next time I can pick up where we left off? You can forget it any time.");
          renderMemory(log,"consent");
        }
      } else {
        say(log,esc(res&&res.message?res.message:"Something went wrong. Please try again."));
        bk.step="slots";
        bkLoadSlots(log);
      }
    });
  }
  function bkDoReschedule(log){
    say(log,"Moving your call. One moment.");
    var email=bk.booked?bk.email:bk.reschedEmail;
    bkPost({action:"reschedule",email:email,start:bk.slot.start},function(res){
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
    }
  }
  function bkHandle(q,raw,log){
    if(q==="cancel"||q==="stop"){ bkReset(); say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
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
    if(bk.step==="offer"){
      if(q.indexOf("strategy")>-1){
        if(isStrategyQuestion(q)){ bkReset(); say(log,find(q)); return; }
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
      var si=qualTextService(q);
      if(si>-1){ qualServicePick(log,si); return; }
      say(log,"Please tap one of the choices above, or type what you need.");
      return;
    }
    if(bk.step==="qual-other"){
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
      if(bi>-1){ qualBudgetPick(log,bi); return; }
      say(log,"Please tap one of the choices above, or type your budget.");
      return;
    }
    if(bk.step==="qual-timeline"){
      var ti=qualTextTimeline(q);
      if(ti>-1){ qualTimelinePick(log,ti); return; }
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
      bk.reschedEmail=raw; bk.step="resched-slots"; bkLoadSlots(log); return;
    }
    if(bk.step==="resched-slots"){ say(log,"Please tap one of the times above."); return; }
    if(bk.step==="resched-confirm"){
      if(isYes(q)){ bkDoReschedule(log); return; }
      if(isNo(q)){ bk.step="resched-slots"; say(log,"Here are the open times. Pick one:"); renderSlots(log,bk.slots); return; }
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
  panel.setAttribute("aria-label","Website agent");
  panel.style.cssText="display:none;flex-direction:column;position:fixed;right:20px;bottom:88px;z-index:100;width:400px;max-width:calc(100vw - 40px);max-height:calc(100vh - 110px);max-height:calc(100dvh - 110px);overflow-y:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 14px 34px -18px rgba(15,35,64,.22);padding:16px;font-family:inherit;color:#334155";
  panel.innerHTML="<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:12px;order:1'><p style='margin:0;color:#0f2340;font-weight:700'>Website agent</p><button id='hc-close' aria-label='Close website agent' style='background:#f0dfae;border:2px solid #0b1a30;border-radius:999px;font-size:1em;font-weight:700;line-height:1;cursor:pointer;color:#0b1a30;padding:.25em .5em;min-width:32px;min-height:32px'>X</button></div><p style='margin:0 0 12px;font-size:.9em;order:2'>I am Jessica's website agent. I can answer questions, book a free discovery call, or send you to pay for a strategy session. Only Jessica confirms a session or a price. Type cancel any time to stop.</p><div id='hc-log' aria-live='polite' role='status' style='font-size:.95em;max-height:300px;overflow-y:auto;order:3'></div><div style='display:flex;gap:8px;margin-top:12px;align-items:flex-end;order:5'><label for='hc-q' style='position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)'>Ask about prices or booking</label><input id='hc-q' type='text' aria-label='Ask about prices or booking' placeholder='Ask about prices or booking' style='flex:1;padding:.8em;border:1px solid #e2e8f0;border-radius:10px;font:inherit;font-size:1em'><button id='hc-voice' type='button' aria-label='Speak instead of typing' aria-pressed='false' title='Speak instead of typing' style='background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.8em;cursor:pointer;font:inherit;height:48px;width:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center'><svg width='20' height='20' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 3-2.54 5.1-5.5 5.1S6 14 6 11H4c0 3.41 2.72 6.23 6 6.72V21h4v-3.28c3.28-.49 6-3.31 6-6.72h-2z'/></svg></button><button id='hc-speak' type='button' aria-label='Read replies aloud' aria-pressed='false' title='Read replies aloud' style='background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.8em;cursor:pointer;font:inherit;height:48px;width:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center'><svg width='20' height='20' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z'/></svg></button><button id='hc-send' style='background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.8em 1.2em;cursor:pointer;font:inherit;height:48px;flex-shrink:0'>Ask</button></div><div id='hc-choices' style='order:4;max-height:220px;overflow-y:auto'></div><p style='font-size:.85em;color:#64748b;margin:12px 0 0;order:6'>Try: How much is a strategy session? How do I book? What is in a care plan? How do we work together?</p><button id='hc-forget' type='button' style='display:none;font-size:.85em;background:none;border:0;padding:0;margin-top:8px;cursor:pointer;color:#64748b;text-decoration:underline;order:7'>Forget what you remember about me</button>";
  var st=document.createElement("style"); st.textContent="#hc-toggle:focus-visible{outline:3px solid #0b1a30; outline-offset:2px; box-shadow:0 0 0 6px #f0dfae, 0 10px 22px -8px rgba(15,35,64,.35)}@media (max-width:720px){#hc-toggle{right:12px !important;bottom:12px !important;width:48px !important;height:48px !important}#hc-toggle svg{width:22px !important;height:22px !important}#hc-close{min-width:44px !important;min-height:44px !important}.site-footer{padding-bottom:76px}}"; document.head.appendChild(st);
  document.body.appendChild(btn); document.body.appendChild(panel);
  /* Choice buttons live in #hc-choices, a sibling of the log, so the
     delegated click listener sits on the panel that holds both. */
  panel.addEventListener("click",function(e){
    var t=e.target;
    while(t&&t!==this){
      if(t.getAttribute){
        var s=t.getAttribute("data-hc-slot");
        if(s!==null){ hcSlotPick(Number(s)); return; }
        var c=t.getAttribute("data-hc-confirm");
        if(c!==null){ hcConfirm(c); return; }
        var g=t.getAttribute("data-hc-qual");
        if(g!==null){ var parts=g.split(":"); hcQualPick(parts[0],Number(parts[1])); return; }
        var m=t.getAttribute("data-hc-memory");
        if(m!==null){ var mp=m.split("-"); hcMemoryPick(mp[0],mp[1]); return; }
      }
      t=t.parentNode;
    }
  });
  /* The button stays visible at all times. It used to hide while scrolling,
     but that read as the chat disappearing, so the hide-on-scroll behavior
     was removed. The button is small and sits at the bottom-right corner. */
  function ask(){
    var inp=document.getElementById("hc-q"); var raw=inp.value.trim(); if(!raw) return;
    var q=raw.toLowerCase();
    var log=document.getElementById("hc-log");
    var d=document.createElement("div"); d.innerHTML="<p style='margin:8px 0'><strong>You:</strong> "+esc(raw)+"</p>"; log.appendChild(d); scrollLog(log); inp.value="";
    if(bk.step==="turnaway"){
      if(q==="cancel"||q==="stop"){ bkReset(); say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
      if(isTurnawayWebsiteNeed(q)){ qualStart(log); return; }
      bk.step=null;
      syncSendButton();
    }
    if(bk.step){ bkHandle(q,raw,log); return; }
    if(q.indexOf("strategy")>-1){
      if(isStrategyQuestion(q)){ say(log,find(q)); return; }
      qualStart(log);
      return;
    }
    if(isResched(q)){
      if(bk.booked&&bk.email){ bk.step="resched-slots"; bkLoadSlots(log); }
      else { bk.step="resched-email"; say(log,"I can move your discovery call. What email did you book with?"); }
      return;
    }
    if(isBookIntent(q)){
      if(!BOOKING_ENDPOINT){ say(log,"You can book a free discovery call on the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
      bk.step="offer";
      say(log,BOOK_ANSWER);
      say(log,"Shall I book a discovery call for you?");
      return;
    }
    var reply=find(q);
    if(reply.indexOf("I do not have a published answer for that.")===0){ proactiveFallback(); } else { proactiveAnswered(); }
    say(log,reply);
    if(reply===BOOK_ANSWER){
      if(!BOOKING_ENDPOINT) return;
      bk.step="offer";
      say(log,"Shall I book a discovery call for you?");
    }
  }
  btn.onclick=function(){ var open = panel.style.display==="none"; panel.style.display = open ? "flex" : "none"; btn.setAttribute("aria-expanded", open ? "true" : "false"); if(open){ proactiveChatOpened=true; memGreet(hcLog()); document.getElementById("hc-q").focus(); } else { voiceStopAll(); } };
  document.getElementById("hc-close").onclick=function(){ voiceStopAll(); panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); };
  document.addEventListener("keydown", function(e){ if(e.key==="Escape" && panel.style.display!=="none"){ voiceStopAll(); panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); } });
  document.getElementById("hc-send").onclick=ask;
  document.getElementById("hc-voice").onclick=voiceToggleListen;
  document.getElementById("hc-speak").onclick=voiceToggleReadAloud;
  document.getElementById("hc-forget").onclick=function(){ bkReset(); memForget(); say(hcLog(),"Forgotten. I will not remember this visit."); };
  syncForgetButton();
  document.getElementById("hc-q").addEventListener("keydown", function(e){ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); ask(); } });
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
    if(!BOOKING_ENDPOINT){ say(log,"You can book a free discovery call on the <a href='"+BOOKING_PAGE+"'>booking page</a>."); document.getElementById("hc-q").focus(); return; }
    bk.step="offer";
    say(log,BOOK_ANSWER);
    say(log,"Shall I book a discovery call for you?");
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
