/* Tracker sales page help chat.
   Rule-based, browser only, no external AI and no API key. It answers
   only from the text on the tracker sales page, and it links to the
   section that covers the question. It is not Jessica, and it cannot
   take a payment or change a subscription. Every answer matches the
   sales page wording. No em dashes in any copy.
   Mirrors the structure of assets/js/help-chat.js, with tracker-only
   answers, so no consulting answers can leak into it. */
(function(){
  var answers=[
    {k:["cancel","refund","30 day","unsubscribe"],a:"Cancel anytime. Website subscriptions cancel in your Stripe portal. Play subscriptions cancel in the Play Store. When you cancel, you keep access until the end of the period you paid for, and you are not charged again. First subscription refund: full refund on request within 30 days of your first successful payment. A refund ends your subscription. The 30-day refund applies to your first subscription only. Renewals do not qualify. Website subscriptions are refunded through Stripe. Play Store subscriptions are refunded through the Play Store, under Google Play rules, not by us directly. Duplicate charges, charges after a confirmed cancellation, and clear payment errors are always refunded in full. For subscription, cancellation, or refund help, email <a href=\"mailto:millrjess@gmail.com\">millrjess@gmail.com</a>. We answer refund requests within one business day. That is our response time. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["medical advice","diagnose","doctor","clinician","prescriber","should i take","is it safe"],a:"New Chapter: GLP-1 Tracker\u2122 is a personal organization tool. It does not diagnose, treat, or replace professional medical advice. Always follow the medication instructions from your prescriber. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["only zepbound","only for","wegovy","ozempic","mounjaro","glp-1","which medication","what medication"],a:"No. The tracker is designed for people using Zepbound, Wegovy, Ozempic, Mounjaro, and other GLP-1 medications. You can record your own medication and dose. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["water goal","water","hydration","drink"],a:"Yes. The water goal is adjustable in Settings. Individual hydration needs vary, so follow any guidance your healthcare professional has given you. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["movement","walk","stretch","exercise","workout","strength"],a:"You can record daily movement with quick entries you log in one tap, for walks, stretching, and more. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["companion","ai wellness","assistant","memory","chat"],a:"Your personal AI Wellness Companion is included in the $3.99 a month subscription. It allows 40 messages per device per day. It notices your streaks, speaks first each morning with a gentle question, and remembers you when you ask it to. It gives encouragement, not medical advice. See <a href=\"#features\">everything in one calm place</a>."},
    {k:["backup","back up","restore","recover my","lost my entries","save my entries"],a:"Your entries save automatically on your device, and the app keeps backup copies inside the app. To keep a copy outside the app, open Settings, then Backup and restore, and tap Download backup. The file saves to your phone, in Files under Downloads. To restore, open Settings, then Backup and restore, and tap Restore backup, then choose the backup file. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["privacy","private","my data","sell my","shared","on my device"],a:"Your tracking data stays on your device. When you message the Companion, your message and a short summary of today go to Cloudflare for a reply. Chat messages are not stored. I cannot see your chats. No one at New Chapter can. I cannot see your entries. No one at New Chapter can. Companion Memory is optional, off by default, and you can delete it with Forget me. Anonymous usage statistics go to Google. No ads. We do not sell your health information."},
    {k:["available","play store","google play","android","coming","launch"],a:"The website version is available now. Subscribe above and you will land on the welcome page, where you get your code and the app link. The Play Store version is coming later. See <a href=\"#pricing\">pricing</a>."},
    {k:["demo","try it","sample","free tier","free tracker"],a:"You can try the demo free, no sign-in, sample data only. <a href=\"https://millrjess.github.io/tracker-demo/\">Try the demo</a>."},
    {k:["price","cost","how much","per month","per year","3.99","29.99"],a:"New Chapter: GLP-1 Tracker\u2122 is $3.99 a month or $29.99 a year. Both automatically renew until canceled. The annual plan saves 37%. See <a href=\"#pricing\">pricing</a>."},
    {k:["subscribe","sign up","get started","how do i get","buy","purchase","download"],a:"Four steps. Try the demo free. Subscribe monthly for $3.99 or annually for $29.99, through Stripe: <a href=\"https://buy.stripe.com/8x28wQ8ak57R5Kl9yp6EU00\">Subscribe Monthly</a> or <a href=\"https://buy.stripe.com/00w5kEbmw9o74GhbGx6EU01\">Subscribe Annual</a>. Subscriptions automatically renew until canceled. Cancel anytime. Then get your code from the welcome page (it works for one hour), and enter it in Settings to connect your Companion. See <a href=\"#how-it-works\">how it works</a>."},
    {k:["track","feature","what can i record","what does it do","injection","shot","weight","photo","journal","diary","mood","side effect"],a:"Track medication, injections, weight, protein, hydration, movement, and side effects. It also has a weight chart with a goal line, a diary and side effects log, progress photos, and a monthly review. Everything you track stays on your device. See <a href=\"#features\">everything in one calm place</a>."},
    {k:["email","contact","help","support","question","human","reply"],a:"Email <a href=\"mailto:millrjess@gmail.com\">millrjess@gmail.com</a> for subscription, cancellation, or refund help. Replies within 1 business day."}
  ];

  function find(q){
    q=q.toLowerCase();
    for(var i=0;i<answers.length;i++){
      for(var j=0;j<answers[i].k.length;j++){
        if(q.indexOf(answers[i].k[j])>-1) return answers[i].a;
      }
    }
    return "I do not have a published answer for that. Please email <a href=\"mailto:millrjess@gmail.com\">millrjess@gmail.com</a> and Jessica will reply personally. I cannot take a payment or change a subscription in this chat.";
  }
  var btn=document.createElement("button");
  btn.id="thc-toggle";
  btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  btn.setAttribute("aria-label","Help chat");
  btn.setAttribute("aria-expanded","false");
  btn.style.cssText="position:fixed;outline-offset:2px;right:20px;bottom:20px;z-index:100;background:#E8B54A;color:#233027;border:2px solid #5A6B52;border-radius:50%;width:56px;height:56px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 22px -8px rgba(50,66,48,.35);font-family:inherit;padding:0";
  var panel=document.createElement("div");
  panel.id="thc-panel";
  panel.setAttribute("role","dialog");
  panel.setAttribute("aria-label","Help chat");
  panel.style.cssText="display:none;position:fixed;right:20px;bottom:88px;z-index:100;width:400px;max-width:calc(100vw - 40px);background:#FDFBF7;border:1px solid #d5dccf;border-radius:16px;box-shadow:0 14px 34px -18px rgba(50,66,48,.22);padding:16px;font-family:inherit;color:#233027";
  panel.innerHTML="<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:12px'><p style='margin:0;color:#44503E;font-weight:700'>Help chat</p><button id='thc-close' aria-label='Close help chat' style='background:#E8B54A;border:2px solid #5A6B52;border-radius:999px;font-size:1em;font-weight:700;line-height:1;cursor:pointer;color:#233027;padding:.25em .5em;min-width:32px;min-height:32px'>X</button></div><p style='margin:0 0 12px;font-size:.9em'>This help chat is not Jessica. It answers questions about New Chapter: GLP-1 Tracker\u2122, only from this sales page, and it links you to the section that covers your question. I cannot take a payment or change a subscription.</p><div id='thc-log' aria-live='polite' role='status' style='font-size:.95em;max-height:300px;overflow-y:auto'></div><div style='display:flex;gap:8px;margin-top:12px;align-items:flex-end'><label for='thc-q' style='position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)'>Ask about price, cancelling, or the tracker</label><input id='thc-q' type='text' aria-label='Ask about price, cancelling, or the tracker' placeholder='Ask about the tracker' style='flex:1;min-width:0;padding:.8em;border:1px solid #d5dccf;border-radius:10px;font:inherit;font-size:1em;background:#fff;color:#233027'><button id='thc-send' style='background:#5A6B52;color:#fff;border:0;border-radius:10px;padding:.8em 1.2em;cursor:pointer;font:inherit;height:48px;flex-shrink:0'>Ask</button></div><p style='font-size:.85em;color:#4a554c;margin:12px 0 0'>Try: How much does it cost? How do I cancel? Is it available now? Does it give medical advice?</p>";
  var st=document.createElement("style"); st.textContent="#thc-toggle:focus-visible{outline:3px solid #5A6B52; outline-offset:2px; box-shadow:0 0 0 6px #E8B54A, 0 10px 22px -8px rgba(50,66,48,.35)} #thc-close:focus-visible, #thc-send:focus-visible, #thc-q:focus-visible{outline:3px solid #5A6B52; outline-offset:2px} @media (max-width:620px){ #thc-toggle{bottom:92px !important} #thc-panel{bottom:160px !important} }"; document.head.appendChild(st);
  /* Keep the bubble (and its panel) clear of the sticky Subscribe bar.
     When #sticky-bar is visible, lift the bubble so its bottom sits
     12px above the bar's top edge, using the bar's live position, so
     safe-area insets and bar height are handled exactly. When the bar
     is hidden, the bubble returns to its usual spot (20px desktop,
     92px mobile) and the panel returns to its usual spot. */
  var bar=document.getElementById("sticky-bar");
  function raiseBubble(){
    var raised=false;
    if(bar){
      var r=bar.getBoundingClientRect();
      if(bar.classList.contains("on") && r.bottom>0 && r.top<window.innerHeight){
        var lift=Math.ceil(window.innerHeight-r.top)+12;
        btn.style.setProperty("bottom",lift+"px","important");
        panel.style.setProperty("bottom",(lift+56+12)+"px","important");
        raised=true;
      }
    }
    if(!raised){
      btn.style.setProperty("bottom","20px");
      panel.style.setProperty("bottom","88px");
    }
  }
  if(bar && "MutationObserver" in window){
    new MutationObserver(raiseBubble).observe(bar,{attributes:true,attributeFilter:["class"]});
    bar.addEventListener("transitionend",raiseBubble);
  }
  window.addEventListener("resize",raiseBubble);
  window.addEventListener("scroll",raiseBubble,{passive:true});
  raiseBubble();
  /* Hide the bubble while the hero or the pricing section is in view,
     so it never covers the trial wording in the hero or body text or
     the edge of a Subscribe button at pricing. It reappears once the
     user has scrolled past the hero, except at pricing, where it
     stays hidden. If the chat panel is open when the bubble hides,
     the panel closes too. */
  var hero=document.querySelector(".hero");
  var pricing=document.getElementById("pricing");
  var hideHero=false, hidePricing=false;
  function updateBubble(){
    var hide=hideHero || hidePricing;
    btn.style.display=hide?"none":"";
    if(hide && panel.style.display!=="none"){ panel.style.display="none"; btn.setAttribute("aria-expanded","false"); }
  }
  if("IntersectionObserver" in window){
    if(hero){
      new IntersectionObserver(function(entries){ hideHero=entries[0].isIntersecting; updateBubble(); }).observe(hero);
    }
    if(pricing){
      new IntersectionObserver(function(entries){ hidePricing=entries[0].isIntersecting; updateBubble(); }).observe(pricing);
    }
  }
  document.body.appendChild(btn); document.body.appendChild(panel);
  function ask(){
    var inp=document.getElementById("thc-q"); var q=inp.value.trim(); if(!q) return;
    var log=document.getElementById("thc-log");
    var d=document.createElement("div"); d.innerHTML="<p style='margin:8px 0'><strong>You:</strong> "+q.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</p><p style='margin:8px 0'>"+find(q)+"</p>"; log.appendChild(d); inp.value="";
  }
  btn.onclick=function(){ var open = panel.style.display==="none"; panel.style.display = open ? "block" : "none"; btn.setAttribute("aria-expanded", open ? "true" : "false"); if(open) document.getElementById("thc-q").focus(); };
  document.getElementById("thc-close").onclick=function(){ panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); };
  document.addEventListener("keydown", function(e){ if(e.key==="Escape" && panel.style.display!=="none"){ panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); } });
  document.getElementById("thc-send").onclick=ask;
  document.getElementById("thc-q").addEventListener("keydown", function(e){ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); ask(); } });
})();
