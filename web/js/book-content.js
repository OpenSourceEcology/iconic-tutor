const wiki = slug => `https://wiki.opensourceecology.org/wiki/${slug}`;
export const sources = [
  {id:'mission', title:'OSE Mission', slug:'OSE_Mission', kind:'Foundational reading', note:'The purpose: an economy built on openly shared knowledge and collaboration.'},
  {id:'change', title:'OSE Model of Change', slug:'OSE_Model_of_Change', kind:'Strategy / proposed model', note:'Learning communities that develop people, infrastructure and enterprises together.'},
  {id:'goals', title:'OSE Goals', slug:'OSE_Goals', kind:'Outline', note:'A place to develop OSE’s goals. See OSE Mission for the current explanation of purpose and priorities.'},
  {id:'franchise', title:'Philanthropic Franchise', slug:'Philanthropic_Franchise', kind:'Wiki-tagged OSE Canon', canon:true, note:'A proposed network of locally adapted campuses that reinvest productive surplus in public-purpose work.'},
  {id:'solar', title:'Open Source Solar Microfactory', slug:'Open_Source_Solar_Microfactory', kind:'Project hypothesis', note:'Solar-powered manufacturing linked to housing production. Its modeled economics still need experimental validation.'},
  {id:'rover', title:'Open Source Autonomous Rover', slug:'Open_Source_Autonomous_Rover', kind:'Development proposal', note:'A modular outdoor robot proposal and a pathway toward larger machines and local manufacturing.'},
  {id:'programs', title:'OSE Programs', slug:'OSE_Programs', kind:'Overview / redirects', note:'Redirects to OSE Programs and Offerings. Places machines and institutions within the broader mission.'},
  {id:'cad', title:'Iconic CAD', slug:'Iconic_CAD', kind:'Design vision / in development', note:'Redirects to Iconic CAD Protocol: a shared design language connecting reusable components to fabrication knowledge.'},
  {id:'tutor', title:'OSE Tutor', slug:'OSE_Tutor', kind:'MVP design notes / redirects', note:'A guided workflow that surfaces evidence and missing information, then returns useful contributions to a library.'},
  {id:'crash', title:'Future Builder Crash Course', slug:'Future_Builder_Crash_Course', kind:'Program reading / redirects', note:'Follow the redirects to the Seed Eco-Home Future Builder Crash Course for its learning and building sequence.'},
  {id:'academy', title:'Future Builders Academy', slug:'Future_Builders_Academy', kind:'Education program reading', note:'Production-linked, entrepreneurial and lifelong learning. The wiki links curriculum and application information.'},
  {id:'camping', title:'Camping with Power Tools', slug:'Camping_with_Power_Tools', kind:'Immersive learning format', note:'A camping-based construction-learning experience with practical work, shared meals and teamwork.'},
  {id:'challenge', title:'Collaborative Challenge', slug:'Collaborative_Challenge', kind:'Outline', note:'Program description still to be developed on the wiki.'},
  {id:'fellowship', title:'Bring Your Own Funding Fellowship', slug:'Bring_Your_Own_Funding_Fellowship', kind:'Further reading', note:'Links to BYOF for more on bringing funding to a project.'},
  {id:'weekend', title:'A House in a Weekend', slug:'A_House_in_a_Weekend', kind:'Further reading', note:'Connects to “1000 Homes in a Day” and the wider ambition of collaborative housing production.'},
  {id:'rapid', title:'Rapid Learning Tools', slug:'Rapid_Learning_Tools', kind:'Learning tools index', note:'Connects Iconic CAD, OSE Tutor, a Rapid Learning Facility and a 1000 Hour Curriculum.'},
].map(source => ({...source, url:wiki(source.slug)}));

export const chapters = [
  {id:'mission', title:'Start with the possibility', subtitle:'01 / WHY OSE EXISTS', sources:['mission','goals'], paragraphs:[
    'When a tool breaks, access to its design changes your options. You can understand how it works, make a replacement part or improve the design. Sharing what you learn gives the next person a better place to start.',
    'OSE describes its mission as creating an open-source economy through collaboration. Its concern is larger than making a collection of inexpensive machines. The mission connects access to productive tools with people’s ability to direct their own lives and do meaningful work.',
    'The same principle applies to a home, a farm or a workshop. People gain more control over their lives when they can understand and improve the systems they depend on. OSE brings open design and practical education together to develop that capability.',
  ], question:'In your own words: what becomes possible when a useful design can be studied, changed and shared?'},
  {id:'people', title:'Build people as well as things', subtitle:'02 / LEARNING AS PARTICIPATION', sources:['change','academy','crash','camping'], paragraphs:[
    'A drawing cannot teach everything on its own. Someone has to learn how to read it, use the tools, notice a problem and work with other people. OSE’s proposed model of change links this human development to the development of practical infrastructure.',
    'The model describes village-scale learning communities that combine education, enterprise and production. Participants would create useful assets as they learn, then carry their knowledge and working methods into further projects. Each community would contribute designs, teaching methods and operating experience for others to use.',
    'The educational entry points have different shapes. Future Builders Academy connects learning with production and entrepreneurship. The crash-course material describes a path through study, practice and housing work. Camping with Power Tools describes a more immersive, camp-based experience of learning through a shared build.',
    'Choose a starting point that fits what you want to learn. A shared build offers practice with tools and teamwork; a longer program offers time to develop a wider set of skills. The program pages connect you with curriculum and organizers.',
  ], question:'What would you like to learn—and what useful thing could you help make while learning it?'},
  {id:'tools', title:'Give knowledge a form people can use', subtitle:'03 / FROM DOCUMENTATION TO DESIGN', sources:['cad','tutor','rapid'], paragraphs:[
    'Shared knowledge needs a usable doorway. A wiki page can preserve context; a drawing can explain geometry; a component library can let a builder reuse a decision instead of starting again. The opportunity is to connect these forms so that an improvement can travel.',
    'Iconic CAD is being developed to let people compose designs from reusable components. Each component connects a visible shape to information about dimensions, materials and how it fits with other parts. Engineering review and fabrication details are work that each library entry needs as it develops.',
    'The OSE Tutor design notes add guidance: show the next step, expose the evidence, identify what is missing and help the learner contribute a useful artifact. Rapid Learning Tools gathers related starting points. Together, these ideas frame a learning session as a small contribution to shared knowledge.',
    'You can try that loop here. Arrange cabins in the village tutor, inspect or change a library entry with the FreeCAD learning path, then prepare a documented contribution with the wiki tutor. A saved model is a beginning; clear provenance, limitations and review make it more useful to someone else.',
  ], question:'What would another person need in order to reuse your work without having to ask you everything?'},
  {id:'projects', title:'Choose something worth building', subtitle:'04 / BUILD WITH OTHER PEOPLE', sources:['cad','crash','camping'], paragraphs:[
    'Start with something you and a few friends would like to make. It could meet a need in your neighborhood, help with work you already do or give you a reason to learn a new skill. Having people who will use it gives the project a purpose and a way to judge whether it works.',
    'Look for an existing design you can learn from. Work out which parts your team understands, where you need experienced help and what tools and materials the work requires. Open documentation lets you benefit from another team’s experience before spending time and money on the same problems.',
    'Choose a first piece of work you can finish together. Build it, test it and record what you change. Teaching a friend how to do a task, correcting a drawing or explaining a mistake can be as useful to the next team as a photograph of the finished object.',
    'Larger projects call for more people, equipment and organization. A shared workshop can support several teams; a campus can bring learning and production together. The scale can grow with what people want to accomplish and the skills and resources they develop.',
  ], question:'What would you like to build with friends, and who would find it useful?'},
  {id:'replication', title:'Share the whole way of working', subtitle:'05 / THE PHILANTHROPIC FRANCHISE', sources:['franchise','programs'], paragraphs:[
    'If one workshop succeeds, how does another community benefit? Sending a machine is one answer. Sharing the knowledge of how to teach, organize, produce and sustain the work is a larger one.',
    'The Philanthropic Franchise page describes a proposed network of locally adapted campuses. Research, education, development and production would work together; productive surplus would support further public-purpose activity. A mature node would help other autonomous nodes develop while sharing improvements across the network.',
    'To help another community start, a campus would need to share more than its product designs: how it trains people, organizes production, pays its costs and improves its work. Those operating practices are part of what the Philanthropic Franchise aims to make reproducible.',
    'A campus would need builders, teachers and people who can run its day-to-day operations. Its courses, workshops and production projects would give them places to work together.',
  ], question:'Beyond blueprints, what would a second team need to reproduce a project responsibly?'},
  {id:'invitation', title:'Leave room for the next person', subtitle:'06 / FROM ALIGNMENT TO AN INVITATION', sources:['challenge','fellowship','weekend','rapid'], paragraphs:[
    'One person may want a place to learn. Another may be able to review a design, document a result, organize a team or support an experiment. Choose a project you care about and find out what the people doing it need.',
    'The reading trail includes Collaborative Challenge, Bring Your Own Funding Fellowship and A House in a Weekend. Their wiki pages are still brief. Developing those descriptions—with a clear purpose, a way to participate and examples of the work—is itself a useful contribution.',
    'A prospective collaborator needs to understand the work, the skills it calls for and the support available. A prospective funder needs to know what has been accomplished, what the next experiment would establish and what it would cost. Specific answers help people decide where they can contribute.',
    'Use the writing workspace below to explain why a project matters to you, show what you have learned about it and invite someone to take a specific next step. A useful invitation might be to visit a workshop, review a design or help plan a field test.',
  ], question:'Who is your reader, what can you honestly show them, and what is one useful next step?'},
];

export const audiencePrompts = {
  collaborator:'Describe a task, why it matters and what help you need. Give the reader enough context to decide whether their skills fit.',
  learner:'Start with a question they care about and a realistic first learning step. Link the program source and ask them to confirm current arrangements with the organizers.',
  supporter:'Explain what has been accomplished, what the next experiment would establish and what resources it needs.',
};
export function bookMarkdown() {
  return '# Mini OSE Book\n## The things we can build together\n\nSeptember 2026\n\nOpen knowledge. Practical skills. Shared productive power.\n\n' + chapters.map(ch => `## ${ch.subtitle}: ${ch.title}\n\n${ch.paragraphs.join('\n\n')}\n\n${ch.ladder ? ch.ladder.map(x => `- ${x[1]}: ${x[2]}`).join('\n') + '\n\n' : ''}Reflection: ${ch.question}\n\nSources:\n${ch.sources.map(id => {const s = sources.find(s => s.id === id); return `- [${s.title}](${s.url})`;}).join('\n')}`).join('\n\n') + '\n\n## Wiki reading trail\n\n' + sources.map(s => `- [${s.title}](${s.url}) — ${s.kind}. ${s.note}`).join('\n') + '\n\nLive OSE Canon category: https://wiki.opensourceecology.org/wiki/Category:OSE_Canon\n\nBased on the work of OSE wiki contributors, linked throughout the book. Book text: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Source pages may carry additional notices.\n\nDesigned by GoodAncestor Foundation — https://www.goodancestor.com\n';
}
