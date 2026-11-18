/* Live-session accessibility watcher for millrjess.github.io.
   Spec: accessibility-catch-and-heal-spec-2026-11-18.md.
   Watches the rendered page while a visitor uses it, for issues that only
   appear in a live session: images without alt text, buttons and links
   without an accessible name, and focus handling around the website agent
   panel. It only watches. It changes nothing on the page, sends nothing
   anywhere, and stores nothing. Findings live in window.__a11yLiveFindings
   and are returned by window.__a11yLiveCheck(). The weekly checks and the
   fix-proposal loop (a11y-heal.js) are where findings become proposals. */
(function(){
  var findings=[];
  /* Text content, excluding anything inside aria-hidden="true": hidden
     text does not count toward an accessible name. */
  function textWithoutHidden(el){
    if(el.getAttribute&&el.getAttribute("aria-hidden")==="true") return "";
    var clone=el.cloneNode(true);
    var hidden=clone.querySelectorAll('[aria-hidden="true"]');
    for(var i=0;i<hidden.length;i++){ hidden[i].remove(); }
    return (clone.textContent||"").trim();
  }
  function accessibleName(el){
    var labelled=el.getAttribute("aria-labelledby");
    if(labelled){
      var parts=[];
      labelled.split(/\s+/).forEach(function(id){
        var t=document.getElementById(id);
        if(t) parts.push(t.textContent);
      });
      if(parts.join(" ").trim()) return parts.join(" ").trim();
    }
    var label=el.getAttribute("aria-label");
    if(label&&label.trim()) return label.trim();
    var text=textWithoutHidden(el);
    if(text) return text;
    var title=el.getAttribute("title");
    if(title&&title.trim()) return title.trim();
    return "";
  }
  function selector(el){
    var s=el.tagName.toLowerCase();
    if(el.id) s+="#"+el.id;
    else if(el.className&&typeof el.className==="string"&&el.className.trim()) s+="."+el.className.trim().split(/\s+/).slice(0,2).join(".");
    return s;
  }
  function add(rule,severity,detail,el){
    findings.push({rule:rule,severity:severity,detail:detail,selector:el?selector(el):""});
  }
  function checkImages(){
    var imgs=document.querySelectorAll("img");
    for(var i=0;i<imgs.length;i++){
      var img=imgs[i];
      if(img.getAttribute("aria-hidden")==="true") continue;
      if(img.getAttribute("role")==="presentation") continue;
      if(!img.hasAttribute("alt")) add("image-alt","serious","Image without an alt attribute. Alt text needs her words.",img);
    }
  }
  function checkNames(){
    var btns=document.querySelectorAll("button");
    for(var i=0;i<btns.length;i++){
      if(btns[i].getAttribute("aria-hidden")==="true") continue;
      if(!accessibleName(btns[i])) add("button-name","serious","Button without an accessible name.",btns[i]);
    }
    var links=document.querySelectorAll("a[href]");
    for(var j=0;j<links.length;j++){
      if(links[j].getAttribute("aria-hidden")==="true") continue;
      if(!accessibleName(links[j])) add("link-name","serious","Link without an accessible name.",links[j]);
    }
  }
  function chatPanel(){
    var dialogs=document.querySelectorAll('div[role="dialog"]');
    for(var i=0;i<dialogs.length;i++){
      if(dialogs[i].querySelector("#hc-q")) return dialogs[i];
    }
    return null;
  }
  function checkChatFocus(){
    var panel=chatPanel();
    if(!panel) return;
    if(panel.style.display!=="none"){
      var active=document.activeElement;
      if(!active||!panel.contains(active)) add("chat-focus","moderate","The website agent panel is open but focus is not inside it.",panel);
    }
  }
  function run(){
    findings=[];
    checkImages();
    checkNames();
    checkChatFocus();
    return findings;
  }
  /* Focus must return to the chat button when the panel closes. The chat
     already does this; the watcher confirms it and records it when it does
     not happen. */
  function watchPanelClose(){
    var panel=chatPanel();
    if(!panel||!window.MutationObserver) return;
    var wasOpen=panel.style.display!=="none";
    var obs=new MutationObserver(function(){
      var isOpen=panel.style.display!=="none";
      if(wasOpen&&!isOpen){
        setTimeout(function(){
          var active=document.activeElement;
          if(!active||active===document.body) add("focus-lost","moderate","Focus was lost when the website agent panel closed. It should return to the chat button.",panel);
        },50);
      }
      wasOpen=isOpen;
    });
    obs.observe(panel,{attributes:true,attributeFilter:["style"]});
  }
  window.__a11yLiveCheck=function(){ return run(); };
  window.__a11yLiveFindings=function(){ return findings.slice(); };
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){ run(); watchPanelClose(); });
  } else {
    run();
    watchPanelClose();
  }
})();
