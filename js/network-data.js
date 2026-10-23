'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PhoenixNetworkData=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const sites={
  nvidia:{name:'Definitely Not NVIDIA',logo:'NOT NVIDIA',tag:'Graphics technology for problems that did not need graphics technology.',theme:'nvidia'},
  news:{name:'PHOENIX News',logo:'PHOENIX NEWS',tag:'Independent fictional journalism for an imaginary world.',theme:'news'},
  microsoft:{name:'Definitely Not Microsoft',logo:'NOT MICROSOFT',tag:'Your computer has feelings. We have updates.',theme:'microsoft'},
  weather:{name:'Foogle Weather',logo:'FOOGLE WEATHER',tag:'Forecasts for a world that has never met a meteorologist.',theme:'weather'},
  wikipedia:{name:'Definitely Not Wikipedia',logo:'NOT WIKIPEDIA',tag:'The free encyclopedia of mostly questionable knowledge.',theme:'wiki'},
  reddit:{name:'Definitely Not Reddit',logo:'NOT REDDIT',tag:'The front page of the internet’s imaginary basement.',theme:'reddit'},
  apple:{name:'Definitely Not Apple',logo:'NOT APPLE',tag:'Premium devices. Premium prices. Premium confusion.',theme:'apple'},
  technologies:{name:'PHOENIX Technologies',logo:'PHOENIX TECHNOLOGIES',tag:'Researching tomorrow’s problems today.',theme:'phoenix-tech'},
  steam:{name:'Definitely Not Steam',logo:'NOT STEAM',tag:'Games, reviews, and absolutely no purchasing whatsoever.',theme:'steam'}
 };
 const gpus=[['RTX 9090','900 TB','3 nuclear stations','4 FPS in Minecraft'],['RTX 10090','1.2 PB','the national grid','2 FPS in Solitaire'],['RTX Potato Edition','12 GB','one enthusiastic hamster','144 FPS in Minesweeper'],['RTX 99999 Nuclear','9 EB','a private volcano','8 FPS in Notepad'],['RTX 404 Not Found','???','unknown','benchmark unavailable']];
 const games=[['Grand Theft Toaster VI','Action','900 GB','RTX 9090','A toaster escapes its kitchen and acquires a suspiciously expensive car.'],['Five Nights at Tesco','Horror','47 GB','RTX Potato Edition','Survive five nights while the self-checkout asks if you found everything.'],['Minecraft: Potato Edition','Sandbox','12 TB','RTX Potato Edition','Craft blocks, plant potatoes, and wait for one frame to render.'],['Call of Duty: Microwave Warfare','Shooter','900 GB','RTX 99999 Nuclear','Every weapon is warm. None are recommended by a qualified adult.'],['Windows Update Simulator 2027','Simulation','14 TB','Windows 13','Watch a progress bar reach 99% and reflect on your choices.'],['PHOENIX: The Gecko Awakens','Adventure','64 GB','RTX 9090','A gecko discovers card games, destiny, and a tiny tactical cape.']];
 const articles=[['History of Computers','Computers began as calculating machines and evolved into devices that ask for updates during emergencies.'],['The RTX 9090','The RTX 9090 is a fictional graphics card with more memory than several small moons.'],['Windows 13','Windows 13 is an operating system that requires 512GB RAM and an apology to the motherboard.'],['PHOENIX Entertainment','PHOENIX Entertainment is a fictional studio where every product has a gecko somewhere.'],['The Invention of Wi-Fi','Wi-Fi was invented when two radios politely agreed to stop using cables.']];
 const posts=[['r/DefinitelyNotTechSupport','My RTX 9090 has started charging me rent. Is this normal?','PixelHamster'],['r/PHOENIXOnline','Player 2 has lost 47 matches against himself.','CardboardWizard'],['r/PCMasterPotato','Windows 13 says my motherboard needs therapy.','spud_driver'],['r/Windows13','AITA for installing Linux on my neighbour’s microwave?','KernelKettle'],['r/GeckoGaming','My gecko has better frame timing than my PC.','TailoredLatency']];
 return {sites,gpus,games,articles,posts};
});
