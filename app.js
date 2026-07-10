import confetti from 'canvas-confetti';

// ==========================================================================
// STATE MANAGEMENT
// ==========================================================================
let state = {
  activities: [],
  weeklySchedule: [],
  journal: [] // Array of { id, activityId, date, notes, activityText, category, subcategory, level }
};

// LocalStorage Keys
const STORAGE_KEY = 'ai365_user_state';

// Load state from LocalStorage
function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      state.journal = parsed.journal || [];
    } catch (e) {
      console.error('Error loading state from local storage:', e);
      state.journal = [];
    }
  }
}

// Save state to LocalStorage
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    journal: state.journal
  }));
}

// Get completing status for activities
function getCompletedMap() {
  const map = {};
  state.journal.forEach(entry => {
    map[entry.activityId] = true;
  });
  return map;
}

// Helper: Get local YYYY-MM-DD date string
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Format date for display (Dutch locale)
function formatDateForDisplay(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

// Calculate streak
function calculateStreak() {
  if (!state.journal || state.journal.length === 0) return 0;
  
  // Unique dates sorted descending
  const dates = [...new Set(state.journal.map(entry => entry.date))];
  const dateSet = new Set(dates);
  
  let streak = 0;
  let checkDate = new Date();
  const todayStr = getLocalDateString(checkDate);
  
  // If no activity today, check yesterday. If neither, streak is 0.
  if (!dateSet.has(todayStr)) {
    checkDate.setDate(checkDate.getDate() - 1);
    const yesterdayStr = getLocalDateString(checkDate);
    if (!dateSet.has(yesterdayStr)) {
      return 0;
    }
  }
  
  // Count back consecutive days
  while (true) {
    const checkStr = getLocalDateString(checkDate);
    if (dateSet.has(checkStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return streak;
}

// ==========================================================================
// DYNAMIC MARKDOWN PARSER FOR IDEE.MD
// ==========================================================================
async function fetchAndParseIdee() {
  try {
    const response = await fetch('./idee.md');
    if (!response.ok) {
      throw new Error(`Failed to load idee.md: ${response.statusText}`);
    }
    const markdown = await response.text();
    parseIdee(markdown);
  } catch (error) {
    console.error('Error fetching or parsing idee.md:', error);
    // Render basic fallback activities if fetch fails
    state.activities = getFallbackActivities();
    state.weeklySchedule = getFallbackSchedule();
  }
}

function parseIdee(mdText) {
  // Split by the horizontal rule separator '⸻' (Three-Em Dash U+2E3B or general dashes)
  const blocks = mdText.split(/\n\s*⸻+\s*\n/);
  const parsedActivities = [];
  const parsedSchedule = [];
  
  let currentMainCategory = "Algemeen";
  let inCodingMode = false;
  let inWeeklySchedule = false;

  blocks.forEach((block, index) => {
    if (index === 0) return; // Skip intro block
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    const firstLine = lines[0];

    // Detect if this is the weekly schedule section
    if (firstLine.includes("365 AI-avonden") || firstLine.includes("Een leuke uitdaging")) {
      inWeeklySchedule = true;
      currentMainCategory = "Schedule";
      lines.forEach(line => {
        if (line.startsWith('*')) {
          parsedSchedule.push(line.replace(/^\*\s*/, ''));
        }
      });
      return;
    }

    // Detect if this is the Coding Mode section
    if (firstLine.includes("Coding Mode")) {
      inCodingMode = true;
      currentMainCategory = "Coding Mode";
      parseBlockItems(lines.slice(1), "Coding Mode", "Algemeen", "Builder");
      return;
    }

    // Detect numbered main categories (e.g., "1. ChatGPT als consultant")
    const numMatch = firstLine.match(/^(\d+)\.\s*(.*)/);
    if (numMatch) {
      inCodingMode = false;
      currentMainCategory = firstLine;
      
      let currentSub = "Algemeen";
      const blockLines = lines.slice(1);
      
      // ChatGPT als consultant has nested subheadings (Analyse, Dynamics, Product Owner) in one block
      if (firstLine.includes("ChatGPT als consultant")) {
        let i = 0;
        while (i < blockLines.length) {
          const l = blockLines[i];
          if (l.startsWith('*') || l.startsWith('-')) {
            parsedActivities.push(createActivity(l, currentMainCategory, currentSub));
          } else if (l.length < 40 && !l.startsWith('*') && !l.startsWith('-') && !l.includes("Bijvoorbeeld") && !l.includes("Laat AI") && !l.includes("Vraag")) {
            currentSub = l.replace(/:$/, '');
          }
          i++;
        }
      } else {
        // Standard numbered sections
        parseBlockItems(blockLines, currentMainCategory, "Algemeen");
      }
      return;
    }

    // If in Coding Mode, each subsequent block is a subcategory of Coding Mode
    if (inCodingMode) {
      const subCat = firstLine;
      const blockLines = lines.slice(1);
      parseBlockItems(blockLines, "Coding Mode", subCat, "Builder");
      return;
    }

    // Blocks 2 and 3 belong to "ChatGPT als consultant" (Dynamics, Product Owner)
    if (index > 0 && index < 4) {
      const subCat = firstLine;
      const blockLines = lines.slice(1);
      parseBlockItems(blockLines, "1. ChatGPT als consultant", subCat, "Collaborator");
      return;
    }

    // Other blocks (e.g., AI als coach, AI als denktrainer, etc.)
    const cat = firstLine;
    const blockLines = lines.slice(1);
    parseBlockItems(blockLines, cat, "Algemeen");
  });

  function parseBlockItems(blockLines, mainCat, subCat, forceLevel = null) {
    let currentSub = subCat;
    blockLines.forEach(l => {
      if (l.startsWith('*') || l.startsWith('-')) {
        parsedActivities.push(createActivity(l, mainCat, currentSub, forceLevel));
      } else if (l.endsWith(':') || l.length < 35) {
        // Simple heuristic to detect subsection headings like "Bijvoorbeeld:" vs actual sub-categories
        const skipHeaders = ["Bijvoorbeeld", "Laat AI", "Vraag", "Elke avond", "Bouw tools", "Maak tools", "Bespreek", "Laat AI telkens", "Iedere avond", "Vraag AI"];
        const shouldSkip = skipHeaders.some(h => l.includes(h));
        if (!shouldSkip) {
          currentSub = l.replace(/:$/, '');
        }
      } else if (l.length > 5 && !l.startsWith('⸻') && !l.includes("Elke avond") && !l.includes("Hier zit waarschijnlijk") && !l.includes("Je houdt van")) {
        // Some activities aren't bulleted but are paragraphs
        parsedActivities.push(createActivity(l, mainCat, currentSub, forceLevel));
      }
    });
  }

  function createActivity(textLine, mainCat, subCat, forceLevel = null) {
    const text = textLine.replace(/^[\*\-\s]+/, '').trim();
    const cleanMainCat = mainCat.replace(/^\d+\.\s*/, '');
    
    // Determine Level: Consumer, Collaborator, Creator, Builder
    let level = "Consumer";
    if (forceLevel) {
      level = forceLevel;
    } else {
      const catLower = cleanMainCat.toLowerCase();
      const subLower = subCat.toLowerCase();
      
      if (catLower.includes("coding mode") || catLower.includes("builder") || subLower.includes("tool") || subLower.includes("game") || subLower.includes("hulpmiddelen") || subLower.includes("automatiseren")) {
        level = "Builder";
      } else if (catLower.includes("muziek") || catLower.includes("creativiteit") || catLower.includes("piano") || catLower.includes("schrijven") || catLower.includes("experimenten")) {
        level = "Creator";
      } else if (catLower.includes("consultant") || catLower.includes("coach") || catLower.includes("denktrainer") || catLower.includes("simulator") || catLower.includes("programmeren") || catLower.includes("reverse") || catLower.includes("onderzoek") || catLower.includes("docent") || catLower.includes("filosofie") || catLower.includes("ontwikkeling")) {
        level = "Collaborator";
      }
    }

    // Generate stable base64-like ID based on category and text
    const key = `${cleanMainCat}_${subCat}_${text}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash |= 0;
    }
    const id = 'act_' + Math.abs(hash).toString(36);

    return {
      id,
      text,
      category: cleanMainCat,
      subcategory: subCat,
      level
    };
  }

  state.activities = parsedActivities;
  state.weeklySchedule = parsedSchedule;
}

// Fallback data if file loading fails
function getFallbackActivities() {
  return [
    { id: "f1", text: "Laat AI een user story bekritiseren.", category: "ChatGPT als consultant", subcategory: "Analyse", level: "Collaborator" },
    { id: "f2", text: "Maak een FetchXML query optimalisatie met AI.", category: "ChatGPT als consultant", subcategory: "Dynamics", level: "Collaborator" },
    { id: "f3", text: "Vraag AI om een reflectievraag over je werkdag.", category: "AI als coach", subcategory: "Algemeen", level: "Collaborator" },
    { id: "f4", text: "Bouw een JSON formatter tool met AI.", category: "Coding Mode", subcategory: "Bouw kleine tools", level: "Builder" },
    { id: "f5", text: "Laat AI akkoordprogressies bedenken voor een compositie.", category: "Muziek", subcategory: "Algemeen", level: "Creator" }
  ];
}

function getFallbackSchedule() {
  return [
    "Maandag: Consultant Lab – verbeter een Dynamics-, Power Platform- of agile-vraagstuk.",
    "Dinsdag: Build Night – maak of verbeter een klein script, tool of prototype.",
    "Woensdag: Learn Deep – verdiep je in een AI-, software- of architectuuronderwerp.",
    "Donderdag: Music Lab – experimenteer met compositie, sound design of muziektheorie.",
    "Vrijdag: Personal Growth – reflecteer op je week en ontwerp een klein gedrags- of werkexperiment.",
    "Zaterdag: Explore – kies een totaal nieuw onderwerp (geschiedenis, natuurkunde, design, economie, psychologie).",
    "Zondag: Ship Something – publiceer of rond iets af: een tool, document, blog, preset, checklist of demo."
  ];
}

// ==========================================================================
// DAILY ROUTINE MAPPINGS
// ==========================================================================
const dayMappings = {
  0: { // Zondag
    theme: "Ship Something",
    desc: "Publiceer of rond iets af: een tool, document, blog, preset, checklist of demo.",
    categories: ["Schrijven", "Coding Mode"],
    subcategories: ["AI Tools", "Games", "Visualisaties"]
  },
  1: { // Maandag
    theme: "Consultant Lab",
    desc: "Verbeter een Dynamics-, Power Platform- of agile-vraagstuk.",
    categories: ["ChatGPT als consultant", "AI als simulator"],
    subcategories: []
  },
  2: { // Dinsdag
    theme: "Build Night",
    desc: "Maak of verbeter een klein script, tool of prototype.",
    categories: ["Coding Mode"],
    subcategories: ["Bouw kleine tools", "Dynamics hulpmiddelen", "Persoonlijke tools", "Data", "Automatiseren"]
  },
  3: { // Woensdag
    theme: "Learn Deep",
    desc: "Verdiep je in een AI-, software- of architectuuronderwerp.",
    categories: ["Leren", "Reverse engineering", "Leren programmeren met AI", "AI als docent"],
    subcategories: []
  },
  4: { // Donderdag
    theme: "Music Lab",
    desc: "Experimenteer met compositie, sound design of muziektheorie.",
    categories: ["Muziek", "Piano", "Coding Mode"],
    subcategories: ["Muziek"]
  },
  5: { // Vrijdag
    theme: "Personal Growth",
    desc: "Reflecteer op je week en ontwerp een klein gedrags- of werkexperiment.",
    categories: ["AI als coach", "Persoonlijke ontwikkeling", "Gezondheid", "Filosofie", "Experimenten"],
    subcategories: []
  },
  6: { // Zaterdag
    theme: "Explore",
    desc: "Kies een totaal nieuw onderwerp (geschiedenis, natuurkunde, design, economie, psychologie).",
    categories: ["AI als denktrainer", "AI als onderzoekspartner", "Brainstormmachine", "Samenvatten"],
    subcategories: []
  }
};

const dayNamesDutch = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];

// Get today's daily focus recommendations
function getTodayFocusRecommendations() {
  const today = new Date().getDay();
  const mapping = dayMappings[today];
  
  return state.activities.filter(act => {
    const catMatch = mapping.categories.includes(act.category);
    const subMatch = mapping.subcategories.includes(act.subcategory);
    return catMatch || subMatch;
  });
}

// ==========================================================================
// UI CONTROLLERS & RENDERING
// ==========================================================================

// Global state for current view and filters
let activeView = 'dashboard';
let currentFilters = {
  search: '',
  level: 'all',
  category: 'all',
  hideCompleted: false
};

// Initialize Application
async function initApp() {
  loadState();
  await fetchAndParseIdee();
  
  // Render sidebar daily focus
  renderSidebarDailyFocus();
  
  // Render views
  renderAll();
  
  // Setup event listeners
  setupEventListeners();
  
  // Initialize Lucide Icons
  lucide.createIcons();
}

// Render Sidebar focus panel
function renderSidebarDailyFocus() {
  const today = new Date().getDay();
  const mapping = dayMappings[today];
  
  document.getElementById('focus-day-name').textContent = dayNamesDutch[today];
  document.getElementById('focus-day-topic').textContent = mapping.theme;
  document.getElementById('focus-day-desc').textContent = mapping.desc;
  
  const recommendationsThemeTag = document.getElementById('recommendations-theme-tag');
  if (recommendationsThemeTag) {
    recommendationsThemeTag.textContent = mapping.theme;
  }
}

// Render everything
function renderAll() {
  updateStats();
  renderDashboard();
  renderActivitiesGrid();
  renderCategorySelect();
  renderJournal();
}

// Update stats (Sidebar & Dashboard)
function updateStats() {
  const completedMap = getCompletedMap();
  const totalCount = state.activities.length;
  const completedCount = Object.keys(completedMap).length;
  
  // Update badges
  document.getElementById('activity-count-badge').textContent = totalCount;
  document.getElementById('completed-count-badge').textContent = completedCount;
  
  // Update streak
  const streak = calculateStreak();
  document.getElementById('streak-display').textContent = `${streak} ${streak === 1 ? 'dag' : 'dagen'}`;
  
  const streakSubText = document.getElementById('streak-subtext');
  if (streak > 0) {
    streakSubText.textContent = 'Lekker bezig! Hou deze flow vast!';
  } else {
    streakSubText.textContent = 'Begin vandaag met je eerste activiteit!';
  }
  
  // Update progress circle on dashboard
  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  document.getElementById('stats-percentage').textContent = `${percentage}%`;
  
  const progressRing = document.getElementById('stats-progress-ring');
  if (progressRing) {
    // Circumference of our circle path (r=15.9155) is 2 * pi * r = 100.
    progressRing.setAttribute('stroke-dasharray', `${percentage}, 100`);
  }
  
  // Update levels breakdown stats
  const levels = ["Consumer", "Collaborator", "Creator", "Builder"];
  levels.forEach(lvl => {
    const lvlAct = state.activities.filter(a => a.level === lvl);
    const lvlTotal = lvlAct.length;
    const lvlDone = lvlAct.filter(a => completedMap[a.id]).length;
    const lvlPct = lvlTotal > 0 ? (lvlDone / lvlTotal) * 100 : 0;
    
    const countEl = document.getElementById(`level-count-${lvl.toLowerCase()}`);
    const barEl = document.getElementById(`level-bar-${lvl.toLowerCase()}`);
    
    if (countEl) countEl.textContent = `${lvlDone} / ${lvlTotal}`;
    if (barEl) barEl.style.width = `${lvlPct}%`;
  });
  
  // Update Journal counts
  const totalJournal = state.journal.length;
  const thisWeekJournal = state.journal.filter(entry => {
    const entryDate = new Date(entry.date);
    const diffTime = Math.abs(new Date() - entryDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  }).length;
  const journalWithNotes = state.journal.filter(entry => entry.notes && entry.notes.trim().length > 0).length;
  
  const jStatTotal = document.getElementById('journal-stat-total');
  const jStatWeek = document.getElementById('journal-stat-this-week');
  const jStatNotes = document.getElementById('journal-stat-notes');
  
  if (jStatTotal) jStatTotal.textContent = totalJournal;
  if (jStatWeek) jStatWeek.textContent = thisWeekJournal;
  if (jStatNotes) jStatNotes.textContent = journalWithNotes;
  
  // Render motivational quote
  renderMotivationalQuote(percentage);
}

// Render dynamic quotes
function renderMotivationalQuote(percentage) {
  const quoteEl = document.getElementById('motivational-quote');
  if (!quoteEl) return;
  
  const quotes = [
    "Niet 'AI leren', maar AI normaliseren. Avontuur zit in kleine stapjes.",
    "Elke dag 15 minuten experimenteren bouwt in een jaar een enorme voorsprong op.",
    "Gebruik AI niet alleen als tool, maar als sparringpartner voor je ideeën.",
    "De beste manier om te leren bouwen met AI is simpelweg beginnen met kleine scripts.",
    "Stel kritische vragen aan je AI-assistent. Daag hem uit om je tegenspreken.",
    "Vier je kleine overwinningen. Elk experiment is een stap vooruit.",
    "Probeer vandaag eens een andere AI-tool of een nieuw prompt-patroon."
  ];
  
  // Select quote based on day of month to rotate
  const index = new Date().getDate() % quotes.length;
  quoteEl.textContent = `"${quotes[index]}"`;
}

// Render Dashboard View
function renderDashboard() {
  const recommendationsList = document.getElementById('recommendations-list');
  if (!recommendationsList) return;
  
  const recommendations = getTodayFocusRecommendations();
  const completedMap = getCompletedMap();
  
  // Limit to 4 items on dashboard for cleaner look
  const itemsToShow = recommendations.slice(0, 4);
  
  if (itemsToShow.length === 0) {
    recommendationsList.innerHTML = '<p class="empty-state">Geen specifieke focusactiviteiten voor vandaag.</p>';
    return;
  }
  
  recommendationsList.innerHTML = '';
  itemsToShow.forEach(act => {
    const isCompleted = completedMap[act.id] || false;
    
    const card = document.createElement('div');
    card.className = `rec-card ${isCompleted ? 'completed' : ''}`;
    card.dataset.id = act.id;
    
    card.innerHTML = `
      <button class="rec-card-checkbox" aria-label="Markeer als voltooid" style="${isCompleted ? 'border-color: var(--color-success); background: var(--color-success); color: #fff;' : ''}">
        ${isCompleted ? '<i data-lucide="check" style="width: 14px; height: 14px; stroke-width: 3;"></i>' : ''}
      </button>
      <div class="rec-card-content">
        <div class="rec-card-text">${act.text}</div>
        <div class="rec-card-meta">
          <span class="level-badge badge-${act.level.toLowerCase()}">${act.level}</span>
          <span class="category-tag">${act.category}</span>
        </div>
      </div>
    `;
    
    // Add checkbox click listener
    const checkbox = card.querySelector('.rec-card-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleActivityCompletion(act.id);
    });
    
    // Clicking card opens modal note entry or highlights
    card.addEventListener('click', () => {
      showJournalNoteModal(act.id);
    });
    
    recommendationsList.appendChild(card);
  });
  
  lucide.createIcons({
    attrs: {
      'stroke-width': 2
    }
  });
}

// Populate Category Selector Options
function renderCategorySelect() {
  const select = document.getElementById('category-select');
  if (!select || select.children.length > 1) return; // Already populated
  
  // Extract unique categories
  const categories = [...new Set(state.activities.map(a => a.category))].sort();
  
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

// Render Activities Grid View
function renderActivitiesGrid() {
  const grid = document.getElementById('activities-grid');
  if (!grid) return;
  
  const completedMap = getCompletedMap();
  
  // Filter activities
  const filtered = state.activities.filter(act => {
    // Search filter
    const matchesSearch = act.text.toLowerCase().includes(currentFilters.search.toLowerCase()) || 
                          act.category.toLowerCase().includes(currentFilters.search.toLowerCase()) ||
                          act.subcategory.toLowerCase().includes(currentFilters.search.toLowerCase());
    
    // Level filter
    const matchesLevel = currentFilters.level === 'all' || act.level === currentFilters.level;
    
    // Category filter
    const matchesCategory = currentFilters.category === 'all' || act.category === currentFilters.category;
    
    // Completion filter
    const isCompleted = completedMap[act.id] || false;
    const matchesCompletion = !currentFilters.hideCompleted || !isCompleted;
    
    return matchesSearch && matchesLevel && matchesCategory && matchesCompletion;
  });
  
  if (filtered.length === 0) {
    grid.innerHTML = '<p class="empty-state w-full">Geen activiteiten gevonden met de huidige filters.</p>';
    return;
  }
  
  grid.innerHTML = '';
  filtered.forEach(act => {
    const isCompleted = completedMap[act.id] || false;
    
    // Check if there are journal entries for this activity to show a notes icon
    const entriesCount = state.journal.filter(j => j.activityId === act.id && j.notes.trim().length > 0).length;
    
    const card = document.createElement('article');
    card.className = `activity-card glass-panel ${isCompleted ? 'completed' : ''}`;
    card.dataset.id = act.id;
    
    card.innerHTML = `
      <div class="card-top">
        <div class="card-tags">
          <span class="level-badge badge-${act.level.toLowerCase()}">${act.level}</span>
          <span class="category-tag">${act.category}</span>
          ${act.subcategory !== 'Algemeen' ? `<span class="category-tag">${act.subcategory}</span>` : ''}
        </div>
        <button class="btn-card-check" aria-label="Markeer als voltooid" title="${isCompleted ? 'Deselecteer activiteit' : 'Voltooi activiteit'}">
          <i data-lucide="check"></i>
        </button>
      </div>
      
      <p class="activity-card-text">${act.text}</p>
      
      <div class="card-bottom">
        <button class="btn-note ${entriesCount > 0 ? 'has-notes-badge' : ''}" title="Inzichten loggen">
          <i data-lucide="${entriesCount > 0 ? 'file-text' : 'edit-3'}"></i>
          <span>${entriesCount > 0 ? `${entriesCount} Notities` : 'Notities'}</span>
        </button>
      </div>
    `;
    
    // Setup Listeners
    const btnCheck = card.querySelector('.btn-card-check');
    btnCheck.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleActivityCompletion(act.id);
    });
    
    const btnNote = card.querySelector('.btn-note');
    btnNote.addEventListener('click', (e) => {
      e.stopPropagation();
      showJournalNoteModal(act.id);
    });
    
    grid.appendChild(card);
  });
  
  lucide.createIcons();
}

// Render Journal Timeline View
function renderJournal() {
  const timeline = document.getElementById('journal-timeline');
  if (!timeline) return;
  
  if (state.journal.length === 0) {
    timeline.innerHTML = '<p class="empty-state">Je hebt nog geen activiteiten voltooid. Klik op "Alle Activiteiten" of "Kies Willekeurig" om te beginnen!</p>';
    return;
  }
  
  // Sort journal entries descending by date & ID to keep latest on top
  const sortedJournal = [...state.journal].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  
  timeline.innerHTML = '';
  sortedJournal.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    
    item.innerHTML = `
      <div class="timeline-item-header">
        <span class="timeline-date">${formatDateForDisplay(entry.date)}</span>
        <div class="card-tags">
          <span class="level-badge badge-${entry.level.toLowerCase()}">${entry.level}</span>
          <span class="category-tag">${entry.category}</span>
          ${entry.subcategory !== 'Algemeen' ? `<span class="category-tag">${entry.subcategory}</span>` : ''}
        </div>
      </div>
      
      <h4 class="timeline-activity-text">${entry.activityText}</h4>
      
      ${entry.notes && entry.notes.trim().length > 0 ? `
        <div class="timeline-note-box">
          <p>${entry.notes.replace(/\n/g, '<br>')}</p>
        </div>
      ` : ''}
      
      <div class="timeline-actions">
        <button class="btn-timeline-action btn-edit-note" data-journal-id="${entry.id}">
          <i data-lucide="edit-2"></i>
          <span>Notitie bewerken</span>
        </button>
        <button class="btn-timeline-action btn-delete" data-journal-id="${entry.id}">
          <i data-lucide="trash-2"></i>
          <span>Verwijderen</span>
        </button>
      </div>
    `;
    
    // Listeners
    const btnEdit = item.querySelector('.btn-edit-note');
    btnEdit.addEventListener('click', () => {
      editJournalNote(entry.id);
    });
    
    const btnDel = item.querySelector('.btn-delete');
    btnDel.addEventListener('click', () => {
      deleteJournalEntry(entry.id);
    });
    
    timeline.appendChild(item);
  });
  
  lucide.createIcons();
}

// Toggle completion simple click (either creates journal entry with no note or deletes latest completion)
function toggleActivityCompletion(activityId) {
  const completedMap = getCompletedMap();
  const isCompleted = completedMap[activityId] || false;
  
  if (isCompleted) {
    // Unchecking: Remove all entries for this activity in journal
    const originalLength = state.journal.length;
    state.journal = state.journal.filter(entry => entry.activityId !== activityId);
    
    if (state.journal.length !== originalLength) {
      saveState();
      renderAll();
    }
  } else {
    // Checking: Add a default empty-note entry for today
    const act = state.activities.find(a => a.id === activityId);
    if (!act) return;
    
    const entryId = 'j_' + Math.random().toString(36).substring(2, 11);
    const newEntry = {
      id: entryId,
      activityId: act.id,
      date: getLocalDateString(),
      notes: '',
      activityText: act.text,
      category: act.category,
      subcategory: act.subcategory,
      level: act.level
    };
    
    state.journal.push(newEntry);
    saveState();
    
    // Trigger Confetti!
    triggerCelebration();
    
    renderAll();
  }
}

// Show journal note entry modal
function showJournalNoteModal(activityId, editJournalId = null) {
  const act = state.activities.find(a => a.id === activityId);
  if (!act) return;
  
  const modal = document.getElementById('modal-journal-note');
  const form = document.getElementById('form-journal-note');
  const levelBadge = document.getElementById('journal-note-level');
  const categoryTag = document.getElementById('journal-note-cat');
  const activityText = document.getElementById('journal-note-activity-text');
  const textarea = document.getElementById('journal-note-textarea');
  
  // Set badges
  levelBadge.className = `level-badge badge-${act.level.toLowerCase()}`;
  levelBadge.textContent = act.level;
  categoryTag.textContent = act.category;
  activityText.textContent = act.text;
  
  // If editing, preload current note
  if (editJournalId) {
    const entry = state.journal.find(j => j.id === editJournalId);
    textarea.value = entry ? entry.notes : '';
    modal.dataset.editId = editJournalId;
  } else {
    textarea.value = '';
    delete modal.dataset.editId;
  }
  
  modal.dataset.activityId = activityId;
  modal.showModal();
}

// Save journal note from form
function handleJournalFormSubmit(e) {
  e.preventDefault();
  const modal = document.getElementById('modal-journal-note');
  const activityId = modal.dataset.activityId;
  const editId = modal.dataset.editId;
  const notesText = document.getElementById('journal-note-textarea').value;
  
  if (editId) {
    // Edit existing journal entry
    const entry = state.journal.find(j => j.id === editId);
    if (entry) {
      entry.notes = notesText;
    }
  } else {
    // Create new journal entry
    const act = state.activities.find(a => a.id === activityId);
    if (!act) return;
    
    const entryId = 'j_' + Math.random().toString(36).substring(2, 11);
    const newEntry = {
      id: entryId,
      activityId: act.id,
      date: getLocalDateString(),
      notes: notesText,
      activityText: act.text,
      category: act.category,
      subcategory: act.subcategory,
      level: act.level
    };
    
    state.journal.push(newEntry);
    
    // Trigger confetti for new completion
    triggerCelebration();
  }
  
  saveState();
  modal.close();
  renderAll();
}

// Edit a specific journal note (opens modal)
function editJournalNote(journalId) {
  const entry = state.journal.find(j => j.id === journalId);
  if (!entry) return;
  showJournalNoteModal(entry.activityId, journalId);
}

// Delete a specific journal entry
function deleteJournalEntry(journalId) {
  if (confirm("Weet je zeker dat je deze logboeknotitie wilt verwijderen?")) {
    state.journal = state.journal.filter(j => j.id !== journalId);
    saveState();
    renderAll();
  }
}

// Trigger Confetti Celebration
function triggerCelebration() {
  confetti({
    particleCount: 120,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#8a4bf5', '#c14bf5', '#3b82f6', '#10b981', '#f97316']
  });
}

// ==========================================================================
// RANDOMIZER (SPINNER) ENGINE
// ==========================================================================
let spinInterval = null;

function openRandomizerModal() {
  const modal = document.getElementById('modal-randomizer');
  
  // Reset modal state
  document.getElementById('selected-activity-display').style.display = 'none';
  document.getElementById('spinner-card-display').style.display = 'flex';
  document.getElementById('spin-actions').style.display = 'none';
  
  const startBtn = document.getElementById('btn-start-spin');
  startBtn.style.display = 'flex';
  startBtn.disabled = false;
  
  const innerCard = document.querySelector('.spinner-card-inner');
  innerCard.innerHTML = `<span class="spinner-placeholder">Druk op Starten!</span>`;
  
  modal.showModal();
}

function handleStartSpin() {
  const startBtn = document.getElementById('btn-start-spin');
  startBtn.disabled = true;
  
  const spinnerCard = document.getElementById('spinner-card-display');
  spinnerCard.classList.add('spinning');
  
  // Filter activities to uncompleted ones first (optional, let's keep all for fun, but prioritize)
  const pool = state.activities.length > 0 ? state.activities : getFallbackActivities();
  
  let counter = 0;
  let delay = 60; // ms
  
  function shuffle() {
    const randomAct = pool[Math.floor(Math.random() * pool.length)];
    const innerCard = document.querySelector('.spinner-card-inner');
    innerCard.textContent = randomAct.text;
    
    counter++;
    if (counter < 25) {
      // Fast spin
      setTimeout(shuffle, delay);
    } else if (counter < 32) {
      // Slowing down
      delay += 40;
      setTimeout(shuffle, delay);
    } else if (counter < 36) {
      // Even slower
      delay += 100;
      setTimeout(shuffle, delay);
    } else {
      // Settled!
      spinnerCard.classList.remove('spinning');
      const winner = randomAct;
      showWinningActivity(winner);
    }
  }
  
  shuffle();
}

function showWinningActivity(winner) {
  // Hide spinner display, show final result
  document.getElementById('spinner-card-display').style.display = 'none';
  document.getElementById('btn-start-spin').style.display = 'none';
  
  const display = document.getElementById('selected-activity-display');
  const text = document.getElementById('selected-activity-text');
  const lvlBadge = document.getElementById('selected-activity-level');
  const catTag = document.getElementById('selected-activity-cat');
  
  text.textContent = winner.text;
  lvlBadge.className = `level-badge badge-${winner.level.toLowerCase()}`;
  lvlBadge.textContent = winner.level;
  catTag.textContent = winner.category;
  
  display.style.display = 'flex';
  
  // Show action buttons
  const actions = document.getElementById('spin-actions');
  actions.style.display = 'grid';
  
  // Store winning activity ID in modal dataset
  const modal = document.getElementById('modal-randomizer');
  modal.dataset.winnerId = winner.id;
  
  // Mini celebration
  confetti({
    particleCount: 50,
    angle: 60,
    spread: 55,
    origin: { x: 0 }
  });
  confetti({
    particleCount: 50,
    angle: 120,
    spread: 55,
    origin: { x: 1 }
  });
}

// Complete activity from randomizer
function handleCompleteRandomActivity() {
  const modal = document.getElementById('modal-randomizer');
  const winnerId = modal.dataset.winnerId;
  modal.close();
  
  // Open journal note modal to log details
  showJournalNoteModal(winnerId);
}

// Reset all application data
function handleResetAllData() {
  if (confirm("WAARSCHUWING! Weet je zeker dat je alle voortgang en logboeknotities wilt wissen? Dit kan niet ongedaan worden gemaakt.")) {
    state.journal = [];
    saveState();
    renderAll();
  }
}

// ==========================================================================
// EVENT LISTENERS & ROUTING
// ==========================================================================
function setupEventListeners() {
  // Navigation Tabs Routing
  const navButtons = document.querySelectorAll('.nav-btn');
  const viewSections = document.querySelectorAll('.view-section');
  const viewTitle = document.getElementById('view-title');
  
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      activeView = targetView;
      
      // Update nav buttons
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update title
      const viewNames = {
        'dashboard': 'Dashboard',
        'activities': 'Alle Activiteiten',
        'journal': 'Mijn Leerdagboek'
      };
      viewTitle.textContent = viewNames[targetView];
      
      // Show/Hide views
      viewSections.forEach(section => {
        section.classList.remove('active');
        if (section.id === `view-section-${targetView}`) {
          section.classList.add('active');
        }
      });
      
      // Refresh views on change
      if (targetView === 'activities') {
        renderActivitiesGrid();
      } else if (targetView === 'journal') {
        renderJournal();
      }
    });
  });
  
  // Redirect dashboard clicks
  document.getElementById('btn-browse-activities').addEventListener('click', () => {
    document.getElementById('nav-activities').click();
  });
  
  // Random Picker buttons
  document.getElementById('btn-pick-random-header').addEventListener('click', openRandomizerModal);
  document.getElementById('btn-pick-random-hero').addEventListener('click', openRandomizerModal);
  document.getElementById('btn-start-spin').addEventListener('click', handleStartSpin);
  document.getElementById('btn-spin-again').addEventListener('click', handleStartSpin);
  document.getElementById('btn-complete-spin-activity').addEventListener('click', handleCompleteRandomActivity);
  
  // Filter listeners
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    currentFilters.search = e.target.value;
    renderActivitiesGrid();
  });
  
  const levelPills = document.getElementById('level-filters');
  levelPills.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      levelPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilters.level = pill.dataset.filter;
      renderActivitiesGrid();
    });
  });
  
  const categorySelect = document.getElementById('category-select');
  categorySelect.addEventListener('change', (e) => {
    currentFilters.category = e.target.value;
    renderActivitiesGrid();
  });
  
  const hideCompletedCheckbox = document.getElementById('filter-hide-completed');
  hideCompletedCheckbox.addEventListener('change', (e) => {
    currentFilters.hideCompleted = e.target.checked;
    renderActivitiesGrid();
  });
  
  // Journal Note form submission
  document.getElementById('form-journal-note').addEventListener('submit', handleJournalFormSubmit);
  
  // Reset data button
  document.getElementById('btn-reset-data').addEventListener('click', handleResetAllData);
  
  // Modal close handlers (Esc fallback for dialogs)
  const modalRandomizer = document.getElementById('modal-randomizer');
  document.getElementById('btn-close-randomizer').addEventListener('click', () => modalRandomizer.close());
  
  const modalJournalNote = document.getElementById('modal-journal-note');
  document.getElementById('btn-close-journal').addEventListener('click', () => modalJournalNote.close());
  document.getElementById('btn-skip-journal-note').addEventListener('click', () => {
    // If not editing, log entry without notes
    const editId = modalJournalNote.dataset.editId;
    if (!editId) {
      const activityId = modalJournalNote.dataset.activityId;
      const act = state.activities.find(a => a.id === activityId);
      if (act) {
        const entryId = 'j_' + Math.random().toString(36).substring(2, 11);
        state.journal.push({
          id: entryId,
          activityId: act.id,
          date: getLocalDateString(),
          notes: '',
          activityText: act.text,
          category: act.category,
          subcategory: act.subcategory,
          level: act.level
        });
        saveState();
        triggerCelebration();
      }
    }
    modalJournalNote.close();
    renderAll();
  });

  // Polyfills & fallbacks for dialog backdrop light dismiss (closedby="any" fallback)
  setupDialogDismissFallback(modalRandomizer);
  setupDialogDismissFallback(modalJournalNote);
}

// Light dismiss fallback for dialogs in unsupported browsers
function setupDialogDismissFallback(dialog) {
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );
      if (isDialogContent) return;
      dialog.close();
      
      // Specific cleanup if closing note modal
      if (dialog.id === 'modal-journal-note') {
        renderAll();
      }
    });
  }
}

// Run App!
document.addEventListener('DOMContentLoaded', initApp);
