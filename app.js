import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ==========================================
// AUTHENTICATION & LOADING SEQUENCE
// ==========================================
window.addEventListener('load', async () => {
  const loadingVideo = document.getElementById('loading-video');
  const loadingScreen = document.getElementById('loading-screen');
  const authScreen = document.getElementById('auth-screen');
  
  if (loadingVideo) loadingVideo.playbackRate = 1.5; 

  // 1. Check if Sarah is already logged in
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    // She is logged in. Load the data silently in the ground.
    loadBooks(); 
  } else {
    // She is NOT logged in. Remove the hidden class so the card waits under the veil.
    if (authScreen) authScreen.classList.remove('hidden');
  }

  // 2. Run the smooth cinematic fade REGARDLESS of login status
  const videoFadeTime = 2000; 
  const backgroundFadeTime = 3000; 

  setTimeout(() => { if (loadingVideo) loadingVideo.style.opacity = '0'; }, videoFadeTime);
  setTimeout(() => { if (loadingScreen) loadingScreen.classList.add('hidden'); }, backgroundFadeTime);
});

// ==========================================
// LOGIN BUTTON LOGIC
// ==========================================
document.getElementById('auth-login-btn').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const errorText = document.getElementById('auth-error');
  const loginBtn = document.getElementById('auth-login-btn');
  
  errorText.style.display = 'none';
  loginBtn.textContent = 'Verifying...';

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    errorText.textContent = "Oops! " + error.message;
    errorText.style.display = 'block';
    loginBtn.textContent = 'Open Library';
  } else {
    // Success! Hide the login screen and load the app
    document.getElementById('auth-screen').classList.add('hidden');
    
    // --> Call your function to fetch the books here! <--
    loadBooks(); 
  }
})

// ==========================================
// 1. SETUP, STATE & GLOBAL VARIABLES
// ==========================================
const supabaseUrl = 'https://jvsjzlvabtffhsnvmcto.supabase.co';
const supabaseKey = 'sb_publishable_H2EPwvAaziQVz8T4yExdEw_bQrB5f3V';
const supabase = createClient(supabaseUrl, supabaseKey);

let globalLibraryData = [];
let libraryYearFilter = 'all'; // Tracks if the library is currently filtered by a specific year
let currentOpenBookId = null;
let returnViewId = 'view-library';

// Common DOM Elements
const bookGrid = document.getElementById('book-grid');
const sheet = document.querySelector('.bottom-sheet:not(#wander-sheet)');
const sheetHandle = document.querySelector('.sheet-handle');
const topFab = document.getElementById('top-fab'); 
const bookshelfContainer = document.querySelector('.bookshelf');
const searchResultsContainer = document.getElementById('search-results-container');

// Sync manual dropdowns with pre-built Quick Filters
const wanderSelects = document.querySelectorAll('#wander-sheet select');
wanderSelects.forEach(select => {
  select.addEventListener('change', () => {
    // CLEAR the year filter anytime Sarah manually changes views!
    libraryYearFilter = 'all';
    // If Sarah manually changes a dropdown, strip the 'active' green color from all quick buttons
    document.querySelectorAll('.quick-btn, .filter-btn').forEach(btn => btn.classList.remove('active'));
    
    applyLibraryFilters();
    
    // Safely target the sheet without crashing
    const sheetEl = document.getElementById('wander-sheet');
    if (sheetEl) sheetEl.classList.remove('open');
  });
});

// ==========================================
// CUSTOM SYSTEM MODAL LOGIC
// ==========================================
function showStacksModal(title, message, isConfirm = false) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('stacks-modal-overlay');
    const titleEl = document.getElementById('stacks-modal-title');
    const messageEl = document.getElementById('stacks-modal-message');
    const cancelBtn = document.getElementById('stacks-modal-cancel');
    const confirmBtn = document.getElementById('stacks-modal-confirm');

    titleEl.textContent = title;
    messageEl.textContent = message;

    if (isConfirm) {
      cancelBtn.style.display = 'block';
      confirmBtn.textContent = 'Yes';
    } else {
      // If it is just an alert, hide the cancel button
      cancelBtn.style.display = 'none';
      confirmBtn.textContent = 'Okay';
    }

    overlay.classList.remove('hidden');

    const cleanup = () => {
      overlay.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
    };

    const onCancel = () => { cleanup(); resolve(false); };
    const onConfirm = () => { cleanup(); resolve(true); };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
  });
}

// ==========================================
// 2. UTILITY & HELPER FUNCTIONS
// ==========================================

// Highly resilient helper to find data regardless of database capitalization
const getField = (obj, fieldName) => {
  if (!obj) return undefined;
  const key = Object.keys(obj).find(k => k.toLowerCase() === fieldName.toLowerCase());
  return key ? obj[key] : undefined;
};

// Formats DB timestamp to "MM-DD-YY" for the vintage stamp
function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  return `${m}-${d}-${y}`;
}

// Fallback cover generator
function getCoverUrl(isbn) {
  if (!isbn || isbn === 'N/A') return 'https://placehold.co/150x200?text=No+Cover';
  const cleanIsbn = String(isbn).replace(/[-\s]/g, '');
  return `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-M.jpg?default=false`;
}

// Reusable function to update Supabase AND local memory
async function updateBookData(columnName, newValue) {
  if (!currentOpenBookId) return;

  const { data, error } = await supabase
    .from('books')
    .update({ [columnName]: newValue })
    .eq('uuid', currentOpenBookId);

  if (error) {
    console.error('Error updating book:', error);
  } else {
    const bookToUpdate = globalLibraryData.find(b => b.uuid === currentOpenBookId);
    if (bookToUpdate) {
      const key = Object.keys(bookToUpdate).find(k => k.toLowerCase() === columnName.toLowerCase()) || columnName;
      bookToUpdate[key] = newValue;
    }
  }
}

// Navigates from the Hero Section to a specific filtered Library view
function navigateToQuickFilter(status, sort, sourceBtn = null) {
  // 1. Switch to Library tab
  document.querySelector('.nav-item[data-target="view-library"]').click();
  
  // 2. Clear Stats year lock
  libraryYearFilter = 'all';

  // 3. Visually update the Quick Filters in the Wander Drawer
  document.querySelectorAll('.quick-btn, .filter-btn').forEach(b => b.classList.remove('active'));
  const targetBtn = document.querySelector(`.quick-btn[data-status="${status}"]`);
  if (targetBtn) targetBtn.classList.add('active');

  // 4. Update the Pill Buttons to stay highlighted
  document.querySelectorAll('.hero-pill-btn').forEach(b => b.classList.remove('active'));
  if (sourceBtn) sourceBtn.classList.add('active');

  // 5. Apply the sort and filter (Removed the scroll logic!)
  window.lastAppliedSort = sort; 
  applyLibraryFilters();
  
}

// ==========================================
// 3. CORE LIBRARY RENDERING (Grid, Hero, Stats)
// ==========================================

// Calculate and render Stats Page numbers
function calculateStats() {
  const books = globalLibraryData;
  const timeFilterEl = document.getElementById('stats-timefilter');
  const filter = timeFilterEl ? timeFilterEl.value : 'year';
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const activeCount = books.filter(b => Number(getField(b, 'status')) === 0).length;
  
  let periodCount = 0;
  const completedBooks = books.filter(b => Number(getField(b, 'status')) === 1 && getField(b, 'read_date'));
  
  completedBooks.forEach(b => {
    const readDate = new Date(getField(b, 'read_date'));
    if (filter === 'all') periodCount++;
    else if (filter === 'year' && readDate.getFullYear() === currentYear) periodCount++;
    else if (filter === 'month' && readDate.getFullYear() === currentYear && readDate.getMonth() === currentMonth) periodCount++;
  });

  const categoryCounts = {};
  books.forEach(b => {
    const cat = getField(b, 'category');
    if (cat && cat !== 'Uncategorized' && cat !== 'N/A') {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
  });

  const sortedCategories = Object.keys(categoryCounts).sort((a, b) => categoryCounts[b] - categoryCounts[a]);
  const topCategories = sortedCategories.slice(0, 3); 

  const statActiveEl = document.getElementById('stat-active');
  const statYearlyEl = document.getElementById('stat-yearly');
  const statCategoriesEl = document.getElementById('stat-categories');

  if (statActiveEl) statActiveEl.textContent = activeCount;
  
  if (statYearlyEl) {
    statYearlyEl.textContent = periodCount;
    const labelEl = statYearlyEl.nextElementSibling;
    if (labelEl) {
        labelEl.textContent = filter === 'month' ? 'Books Read This Month' : 
                              filter === 'year' ? 'Books Read This Year' : 
                              'Total Books Read';
    }
  }

  if (statCategoriesEl) {
    if (topCategories.length === 0) {
      statCategoriesEl.innerHTML = '<li>No categories yet</li>';
    } else {
      statCategoriesEl.innerHTML = topCategories.map(cat => `<li>${cat} (${categoryCounts[cat]})</li>`).join('');
    }
  }
}

// ==========================================
// PHASE 4: STATS DASHBOARD 2.0
// ==========================================
let statsChartInstance = null; 
let currentStatsYear = 'all';
let currentStatsMonth = null;

const renderStatsList = (booksArray, listTitle) => {
  document.getElementById('stats-list-title').textContent = listTitle;
  const listContainer = document.getElementById('stats-book-list');
  listContainer.innerHTML = '';

  if (booksArray.length === 0) {
    listContainer.innerHTML = `<p style="text-align: center; color: var(--sage-green); font-family: 'Courier New'; margin-top: 20px;">No books finished in this timeframe.</p>`;
    return;
  }

  booksArray.forEach(book => {
    const title = getField(book, 'title') || 'Unknown';
    const author = getField(book, 'author') || 'Unknown';
    const coverUrl = getField(book, 'cover_url') || 'https://placehold.co/150x200?text=No+Cover'; // Make sure this matches your actual placeholder filename!
    const ratingNum = Number(getField(book, 'rating')) || 0;
    
    let ratingDisplay = '<span style="color: #b3bfae; font-size: 11px; font-family: \'Courier New\';">No Rating</span>';
    if (ratingNum > 0) ratingDisplay = '★'.repeat(ratingNum) + '<span style="color: #e0dcd3;">' + '★'.repeat(5 - ratingNum) + '</span>';

    const card = document.createElement('div');
    card.className = 'book-card';
    card.innerHTML = `
      <img src="${coverUrl}" alt="${title}" class="book-cover" onerror="this.src='https://placehold.co/150x200?text=No+Cover'">
      <div class="book-info">
        <p class="book-title">${title}</p>
        <p class="book-author">${author}</p>
        <div class="book-rating" style="display: block; margin-top: auto; color: #DDA750; font-size: 12px; letter-spacing: 2px;">${ratingDisplay}</div>
      </div>
    `;
    card.addEventListener('click', () => openDetails(book));
    listContainer.appendChild(card);
  });
};

function renderAnnualStats(targetYear) {
  currentStatsYear = targetYear;
  currentStatsMonth = null;
  const finishedBooks = globalLibraryData.filter(b => b.status === 2 && b.read_date);
  const container = document.getElementById('stats-chart-container');
  
  if (targetYear === 'all') {
    const yearsMap = {};
    finishedBooks.forEach(b => {
      const y = b.read_date.split('-')[0]; 
      yearsMap[y] = (yearsMap[y] || 0) + 1;
    });
    
    const labels = Object.keys(yearsMap).sort();
    const data = labels.map(y => yearsMap[y]);
    
    // Fixed height and Y-axis step 10 for All Time
    container.style.height = '280px';
    drawChart('bar', labels, data, '#A65239', 10, (clickedIndex) => {
      const selectedYear = labels[clickedIndex];
      document.getElementById('stats-year-select').value = selectedYear;
      renderAnnualStats(selectedYear);
    });
    
    renderStatsList(finishedBooks.sort((a, b) => new Date(b.read_date) - new Date(a.read_date)), `All Time Books (${finishedBooks.length})`);
    document.getElementById('stats-drilldown-nav').classList.add('hidden');
    document.getElementById('btn-view-in-stacks').style.display = 'flex';
  } 
  else {
    const filtered = finishedBooks.filter(b => b.read_date.startsWith(targetYear));
    const monthlyCounts = Array(12).fill(0);
    
    filtered.forEach(b => {
      const m = parseInt(b.read_date.split('-')[1]) - 1; 
      monthlyCounts[m]++;
    });

    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const maxValue = Math.max(5, ...monthlyCounts); 
    container.style.height = `${Math.max(250, (maxValue * 25) + 50)}px`; 

    let barColors = Array(12).fill('#597755'); // Default sage green

    drawChart('bar', monthLabels, monthlyCounts, barColors, 1, (clickedIndex) => {
      // Highlight tapped bar orange
      barColors = Array(12).fill('#597755');
      barColors[clickedIndex] = '#A65239';
      statsChartInstance.data.datasets[0].backgroundColor = barColors;
      statsChartInstance.update();

      // Update the list below
      renderMonthlyStatsList(clickedIndex, targetYear); 
    });

    renderStatsList(filtered.sort((a, b) => new Date(b.read_date) - new Date(a.read_date)), `Books Finished in ${targetYear} (${filtered.length})`);
    document.getElementById('stats-drilldown-nav').classList.add('hidden');
    document.getElementById('btn-view-in-stacks').style.display = 'flex';
  };
}

// Replaces the line chart logic with a simple list update for the tapped bar
function renderMonthlyStatsList(monthIndex, yearStr) {
  currentStatsMonth = monthIndex;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  const targetPrefix = `${yearStr}-${String(monthIndex + 1).padStart(2, '0')}`;
  const monthlyBooks = globalLibraryData.filter(b => b.status === 2 && b.read_date && b.read_date.startsWith(targetPrefix));

  // Update the list and hide the Stacks handoff button
  renderStatsList(monthlyBooks.sort((a, b) => new Date(b.read_date) - new Date(a.read_date)), `${fullMonthNames[monthIndex]} ${yearStr} Reads (${monthlyBooks.length})`);
  document.getElementById('btn-view-in-stacks').style.display = 'none'; 

  // Setup the drilldown back button
  const navDiv = document.getElementById('stats-drilldown-nav');
  const backBtn = document.getElementById('btn-stats-back');
  backBtn.innerHTML = `<span style="font-size:12px;">✕</span> Clear ${monthNames[monthIndex]}`;
  
  backBtn.onclick = () => {
    // Reset bar colors back to Sage Green
    statsChartInstance.data.datasets[0].backgroundColor = Array(12).fill('#597755');
    statsChartInstance.update();
    
    // Re-render the full year list and restore the Stacks button
    const filtered = globalLibraryData.filter(b => b.status === 2 && b.read_date && b.read_date.startsWith(yearStr));
    renderStatsList(filtered.sort((a, b) => new Date(b.read_date) - new Date(a.read_date)), `Books Finished in ${yearStr} (${filtered.length})`);
    document.getElementById('btn-view-in-stacks').style.display = 'flex';
    navDiv.classList.add('hidden');
    currentStatsMonth = null;
  };
  
  navDiv.classList.remove('hidden');
}

// Chart Helper for Bars
function drawChart(type, labels, data, color, stepSize, onClickCallback) {
  if (statsChartInstance) statsChartInstance.destroy();
  const ctx = document.getElementById('stats-chart').getContext('2d');
  statsChartInstance = new Chart(ctx, {
    type: type,
    data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (e, elements) => { if (elements.length > 0) onClickCallback(elements[0].index); },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#FAF8F2', titleColor: '#2C3E2D', bodyColor: color, borderColor: '#8B5E34', borderWidth: 1 } },
      scales: {
        y: { suggestedMax: stepSize === 10 ? undefined : 5, ticks: { stepSize: stepSize, font: { family: 'Courier New' } }, grid: { color: 'rgba(139, 94, 52, 0.1)' } },
        x: { ticks: { font: { family: 'Georgia' } }, grid: { display: false } }
      }
    }
  });
}

function initStatsPage() {
  const yearSelect = document.getElementById('stats-year-select');
  const finishedBooks = globalLibraryData.filter(b => b.status === 2 && b.read_date);
  const years = [...new Set(finishedBooks.map(b => b.read_date.split('-')[0]))].sort((a, b) => b - a);
  
  yearSelect.innerHTML = '<option value="all">All Time</option>';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    yearSelect.appendChild(opt);
  });

  yearSelect.addEventListener('change', (e) => renderAnnualStats(e.target.value));

  // "View in Stacks" - Bulletproof Handoff Logic
  document.getElementById('btn-view-in-stacks').addEventListener('click', () => {
    
    // 1. Switch Tabs visually
    document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-library').classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-target="view-library"]').classList.add('active');
    lastActiveTab = 'view-library';

    // 2. Set the global Year Filter based on what the chart is showing
    libraryYearFilter = currentStatsYear; // Will be 'all' or a specific year like '2026'

    // 3. Visually highlight the "Finished" Quick Filter button
    document.querySelectorAll('.quick-btn, .filter-btn').forEach(btn => btn.classList.remove('active'));
    const finishedBtn = document.querySelector('[data-sort="date_finished_desc"]'); // Finds it regardless of class
    if (finishedBtn) finishedBtn.classList.add('active');

    applyLibraryFilters(); 
    
    document.querySelectorAll('.hero-pill-btn').forEach(b => b.classList.remove('active'));
    
    // IDK window.scrollTo({ top: 0, behavior: 'instant' });
  });
}


// Dynamic Active Reads Carousel
function renderHeroSection() {
  const carousel = document.getElementById('active-reads-carousel');
  const heroLabel = document.getElementById('hero-label');
  const wrapper = document.getElementById('current-read-section');
  if (!carousel || !heroLabel) return;

  carousel.innerHTML = ''; 

  const createSlimAddBtn = () => {
    const btn = document.createElement('div');
    btn.className = 'carousel-item slim-add-btn';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    btn.addEventListener('click', () => document.querySelector('.nav-item[data-target="view-search"]').click());
    return btn;
  };

  const createReadAgainCard = () => {
    const card = document.createElement('div');
    card.className = 'carousel-item special-card';
    card.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
        <circle cx="12" cy="9" r="5" fill="var(--card-bg)"></circle>
        <line x1="12" y1="7" x2="12" y2="11" stroke="var(--sage-green)" stroke-width="2"></line>
        <line x1="10" y1="9" x2="14" y2="9" stroke="var(--sage-green)" stroke-width="2"></line>
      </svg>
      <h3>Read Again</h3>
      <p>Revisit an old favorite</p>
    `;
    card.addEventListener('click', () => navigateToQuickFilter('2', 'rating_desc')); // Routes to Finished + Highest Rated
    return card;
  };

  const activeReads = globalLibraryData.filter(b => Number(getField(b, 'status')) === 1);

  // SCENARIO 0: No Active Reads (Pill Buttons)
  if (activeReads.length === 0) {
    heroLabel.textContent = "Start Reading";
    
    const pillContainer = document.createElement('div');
    pillContainer.style.display = 'flex';
    pillContainer.style.gap = '10px';
    pillContainer.style.padding = '5px 0 0 0';
    pillContainer.style.width = '100%';
    pillContainer.style.justifyContent = 'center';
    pillContainer.style.flexWrap = 'wrap';

    const addPill = document.createElement('button');
    addPill.className = 'hero-pill-btn';
    addPill.innerHTML = `+ Add Book`;
    addPill.addEventListener('click', () => {
      // 1. Clear visual active state from hero pills
      document.querySelectorAll('.hero-pill-btn').forEach(b => b.classList.remove('active'));
      
      // 2. Clear visual active state from Wander Drawer buttons
      document.querySelectorAll('.quick-btn, .filter-btn').forEach(b => b.classList.remove('active'));
      
      // 3. Reset any manual dropdowns in the Wander Drawer to their defaults
      document.querySelectorAll('#wander-sheet select').forEach(select => select.selectedIndex = 0);
      
      // 4. Reset the underlying data filters
      libraryYearFilter = 'all';
      window.lastAppliedSort = 'title_asc'; // Or whatever default sort you prefer for "All Books"
      applyLibraryFilters();

      // 5. Route to the Search view
      document.querySelector('.nav-item[data-target="view-search"]').click();
    });

    const tbrPill = document.createElement('button');
    tbrPill.className = 'hero-pill-btn';
    tbrPill.innerHTML = `TBR List`;
    // Pass the button itself (e.currentTarget) to trigger the active state
    tbrPill.addEventListener('click', (e) => navigateToQuickFilter('0', 'date_added_desc', e.currentTarget));

    const againPill = document.createElement('button');
    againPill.className = 'hero-pill-btn';
    againPill.innerHTML = `Read Again`;
    againPill.addEventListener('click', (e) => navigateToQuickFilter('2', 'rating_desc', e.currentTarget));

    pillContainer.appendChild(addPill);
    pillContainer.appendChild(tbrPill);
    pillContainer.appendChild(againPill);
    carousel.appendChild(pillContainer);

  // SCENARIO 1: Exactly 1 Active Read
  } else if (activeReads.length === 1) {
    heroLabel.textContent = "Current Read";
    
    const book = activeReads[0];
    const card = document.createElement('div');
    card.className = 'carousel-item';
    const coverUrl = getField(book, 'cover_url') || 'https://placehold.co/150x200?text=No+Cover';
    card.innerHTML = `<img src="${coverUrl}" alt="${getField(book, 'title')}" class="cover-image">`;
    card.addEventListener('click', () => openDetails(book, card)); 
    
    carousel.appendChild(card);
    carousel.appendChild(createReadAgainCard());
    carousel.appendChild(createSlimAddBtn());

  // SCENARIO 2: Exactly 2 Active Reads
  } else if (activeReads.length === 2) {
    heroLabel.textContent = "Current Reads";
    
    activeReads.forEach(book => {
      const card = document.createElement('div');
      card.className = 'carousel-item';
      const coverUrl = getField(book, 'cover_url') || 'https://placehold.co/150x200?text=No+Cover';
      card.innerHTML = `<img src="${coverUrl}" alt="${getField(book, 'title')}" class="cover-image">`;
      card.addEventListener('click', () => openDetails(book, card)); 
      carousel.appendChild(card);
    });

    carousel.appendChild(createSlimAddBtn());

  // SCENARIO 4+: 4 or more Active Reads
  } else {
    heroLabel.textContent = "Current Reads";
    const displayReads = activeReads.slice(0, 3); // Cap at 3 covers

    displayReads.forEach(book => {
      const card = document.createElement('div');
      card.className = 'carousel-item';
      const coverUrl = getField(book, 'cover_url') || 'https://placehold.co/150x200?text=No+Cover';
      card.innerHTML = `<img src="${coverUrl}" alt="${getField(book, 'title')}" class="cover-image">`;
      card.addEventListener('click', () => openDetails(book, card)); 
      carousel.appendChild(card);
    });

    const seeAllCard = document.createElement('div');
    seeAllCard.className = 'carousel-item special-card';
    seeAllCard.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
      <h3>See All (${activeReads.length})</h3>
    `;
    seeAllCard.addEventListener('click', () => navigateToQuickFilter('1', 'date_started_desc'));
    carousel.appendChild(seeAllCard);
  }

  // Floating scroll-back arrow logic
  let backArrow = document.getElementById('carousel-back-arrow');
  if (!backArrow) {
    backArrow = document.createElement('button');
    backArrow.id = 'carousel-back-arrow';
    backArrow.className = 'carousel-back-arrow hidden';
    backArrow.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
    wrapper.appendChild(backArrow);

    backArrow.addEventListener('click', () => carousel.scrollTo({ left: 0, behavior: 'smooth' }));

    carousel.addEventListener('scroll', () => {
      if (carousel.scrollLeft > 20) backArrow.classList.remove('hidden');
      else backArrow.classList.add('hidden');
    });
  }
}

// Master load function for Library Grid
async function loadBooks() {
  const { data: books, error } = await supabase
    .from('books')
    .select('*')
    .order('title', { ascending: true });

  if (error) { console.error(error); return; }
  
  globalLibraryData = books; 
  calculateStats(); 
  renderHeroSection();
  
  // Instead of drawing the grid here, we trigger the Master Filter!
  applyLibraryFilters();
  
  // Trigger Phase 4 Stats Render
  initStatsPage(); 
  renderAnnualStats(document.getElementById('stats-year-select').value);
}

// ==========================================
// LIBRARY FILTERING & SORTING ENGINE
// ==========================================
function applyLibraryFilters() {
  let filteredBooks = [...globalLibraryData];

  // 1. Get Local Search Term
  const searchInput = document.getElementById('local-search');
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

  // 2. Find the active Quick Filter button (checking both potential class names)
  const activeBtn = document.querySelector('.quick-btn.active, .filter-btn.active');
  const statusFilter = activeBtn ? activeBtn.getAttribute('data-status') : 'all';
  const sortMethod = activeBtn ? activeBtn.getAttribute('data-sort') : 'date_added_desc';

  // 3. Apply All Filters
  filteredBooks = filteredBooks.filter(book => {
    // A. Text Search (Title or Author)
    const title = (getField(book, 'title') || '').toLowerCase();
    const author = (getField(book, 'author') || '').toLowerCase();
    const matchesSearch = title.includes(searchTerm) || author.includes(searchTerm);

    // B. Status Filter
    const status = getField(book, 'status');
    const matchesStatus = (statusFilter === 'all' || !statusFilter) ? true : Number(status) === Number(statusFilter);

    // C. Year Filter (Triggered strictly by the Stats Page handoff)
    let matchesYear = true;
    if (libraryYearFilter !== 'all') {
      matchesYear = (book.status === 2 && book.read_date && book.read_date.startsWith(libraryYearFilter));
    }

    return matchesSearch && matchesStatus && matchesYear;
  });

  // 4. Sort the Data
  filteredBooks.sort((a, b) => {
    if (sortMethod === 'title_asc') {
      return (getField(a, 'title') || 'Z').toLowerCase().localeCompare((getField(b, 'title') || 'Z').toLowerCase());
    } else if (sortMethod === 'author_asc') {
      return (getField(a, 'author') || 'Z').toLowerCase().localeCompare((getField(b, 'author') || 'Z').toLowerCase());
    } else if (sortMethod === 'rating_desc') {
      return (Number(getField(b, 'rating')) || 0) - (Number(getField(a, 'rating')) || 0);
    } else if (sortMethod === 'date_finished_desc') {
      return new Date(b.read_date || 0).getTime() - new Date(a.read_date || 0).getTime();
    } else if (sortMethod === 'date_started_desc') {
      return new Date(b.date_started || 0).getTime() - new Date(a.date_started || 0).getTime();
    } else {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(); // Newest Added
    }
  });

  // 5. Update the Subheading UI
  const subheading = document.getElementById('library-subheading');
  if (subheading) {
    // THE FIX: Change the fallback text to match your default app state
    let headingText = activeBtn ? activeBtn.textContent.trim() : 'All Books, by Title (A-Z)'; 
    if (libraryYearFilter !== 'all') headingText = `Finished in ${libraryYearFilter}`;
    if (searchTerm) headingText += ` (Searching: "${searchTerm}")`; 
    subheading.textContent = headingText;
  }

  // 6. Track state for the renderer and Draw!
  window.lastAppliedSort = sortMethod; 
  renderGrid(filteredBooks);
}

// --- BATCH 7: GRID RENDERER & EMPTY STATE ---
function renderGrid(booksToRender) {
  if (!bookGrid) return;
  bookGrid.innerHTML = '';

  // 1. Set the baseline layout class for the container
  const activeLayout = localStorage.getItem('stacksLayout') || 'layout-grid';
  bookGrid.className = `book-grid ${activeLayout}`;

  // EMPTY STATE: If the filter returns nothing!
  if (booksToRender.length === 0) {
    bookGrid.innerHTML = `
      <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center; opacity: 0.85;">
        <p style="font-family: 'Courier New', Courier, monospace; color: var(--sage-green); font-size: 1.1rem;">
          This stack's empty.
        </p>
      </div>
    `;
    return;
  }

  // PHASE 5 Setup: Use the globally tracked sort method to guarantee accuracy!
  const sortMethod = window.lastAppliedSort || '';
  let currentRenderYear = null;

  // Draw the covers
  for (const book of booksToRender) {
    
    // --- PHASE 5: INJECT CHRONOLOGICAL DIVIDERS ---
    if (sortMethod === 'date_finished_desc' && Number(book.status) === 2 && book.read_date) {
      // Force string and extract YYYY safely
      const bookYear = String(book.read_date).split('-')[0]; 
      
      if (bookYear !== currentRenderYear) {
        currentRenderYear = bookYear;
        const divider = document.createElement('div');
        divider.className = 'year-divider';
        divider.id = `year-header-${currentRenderYear}`; 
        divider.textContent = currentRenderYear;
        bookGrid.appendChild(divider);
      }
    }
    // ----------------------------------------------

    const bookDiv = document.createElement('div');
    bookDiv.className = 'book-card'; 
    
    // Keep active state styling if this book is currently open
    if (typeof currentOpenBookId !== 'undefined' && book.uuid === currentOpenBookId && viewDetails && viewDetails.classList.contains('active')) {
       bookDiv.classList.add('active');
    }
    
    const savedCover = getField(book, 'cover_url');
    const isbn = getField(book, 'isbn');
    const title = getField(book, 'title') || 'Unknown Title';
    const author = getField(book, 'author') || 'Unknown Author';
    const ratingNum = Number(getField(book, 'rating')) || 0;
    
    // Generate the stars: Gold for active, Grey for inactive
    let ratingDisplay = '<span style="color: #b3bfae; font-size: 11px; font-family: \'Courier New\';">No Rating</span>';
    if (ratingNum > 0) {
      ratingDisplay = '★'.repeat(ratingNum) + '<span style="color: #e0dcd3;">' + '★'.repeat(5 - ratingNum) + '</span>';
    }

    // 2. The Standardized Layout HTML
    if (savedCover && savedCover !== 'https://placehold.co/60x90?text=No+Cover') {
      bookDiv.innerHTML = `
        <img src="${savedCover}" data-isbn="${isbn}" alt="${title}" class="book-cover" onerror="this.src='https://placehold.co/60x90?text=No+Cover'">
        <div class="book-info">
          <p class="book-title">${title}</p>
          <p class="book-author">${author}</p>
          <div class="book-rating">${ratingDisplay}</div>
        </div>
      `;
    } else {
      bookDiv.innerHTML = `
        <img src="https://placehold.co/150x200?text=Loading..." data-isbn="${isbn}" alt="${title}" class="book-cover lazy-cover">
        <div class="book-info">
          <p class="book-title">${title}</p>
          <p class="book-author">${author}</p>
          <div class="book-rating">${ratingDisplay}</div>
        </div>
      `;
    }
    
    bookDiv.addEventListener('click', () => openDetails(book, bookDiv));
    bookGrid.appendChild(bookDiv);
  }

  // Re-attach Lazy loading for missing covers
  const lazyCovers = document.querySelectorAll('.lazy-cover');
  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const coverUrl = getCoverUrl(img.dataset.isbn);
        img.src = coverUrl;
        img.onerror = () => { img.src = 'https://placehold.co/60x90?text=No+Cover'; };
        observer.unobserve(img);
      }
    });
  });
  lazyCovers.forEach(img => observer.observe(img));
}

// Attach Event Listeners to Toolbar Inputs
document.getElementById('local-search')?.addEventListener('input', applyLibraryFilters);
document.getElementById('filter-status')?.addEventListener('change', applyLibraryFilters);
document.getElementById('sort-library')?.addEventListener('change', applyLibraryFilters);


// ==========================================
// PHASE 3: FULL PAGE READING JOURNAL
// ==========================================
const viewDetails = document.getElementById('view-details');
const closeDetailsBtn = document.getElementById('close-details-btn');
const journalContent = document.getElementById('journal-content');

function openDetails(book, clickedElement) {
  
  const possibleViews = ['view-library', 'view-search', 'view-stats'];
  possibleViews.forEach(viewId => {
    const viewEl = document.getElementById(viewId);
    if (viewEl && viewEl.classList.contains('active')) {
      returnViewId = viewId;
    }
  });

  window.history.pushState({ level: 'overlay' }, '');
  
  // THE FIX: Use uuid, not id!
  currentOpenBookId = book.uuid; 
  
  const title = getField(book, 'title') || 'Unknown Title';
  const author = getField(book, 'author') || 'Unknown Author';
  const coverUrl = getField(book, 'cover_url') || 'https://placehold.co/60x90?text=No+Cover';
  const ratingNum = Number(getField(book, 'rating')) || 0;
  const statusNum = String(getField(book, 'status') || '0');
  const notes = getField(book, 'notes') || '';
  
  // Date Formatting for Display and Inputs
  const formatStandardDate = (iso) => {
    if (!iso) return '--';
    const d = new Date(iso);
    if (isNaN(d)) return '--';
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
  };
  
  const rawDateAdded = getField(book, 'created_at') || getField(book, 'date_added');
  const dateAdded = formatDate(rawDateAdded) || '--';

  const rawStarted = getField(book, 'date_started');
  const startedVal = rawStarted ? new Date(rawStarted).toISOString().split('T')[0] : '';
  const startedText = rawStarted ? formatStandardDate(rawStarted) : '';

  const rawFinished = getField(book, 'read_date') || getField(book, 'date_finished');
  const finishedVal = rawFinished ? new Date(rawFinished).toISOString().split('T')[0] : '';
  const finishedText = rawFinished ? formatStandardDate(rawFinished) : '';

  // Helper for vintage mm-dd-yy dates
  const formatVintageDate = (iso) => {
    if (!iso) return 'mm-dd-yy';
    const d = new Date(iso);
    if (isNaN(d)) return 'mm-dd-yy';
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getFullYear()).slice(-2)}`;
  };

  // 1. Conditional Stamps (One stamp only, wrapped for centering!)
  let stampsHtml = '';
  if (statusNum === '1') { 
    stampsHtml = `<div class="stamp-container"><span class="stamp stamp-started">STARTED<br/>${formatVintageDate(rawStarted)}</span></div>`;
  } else if (statusNum === '2') { 
    stampsHtml = `<div class="stamp-container"><span class="stamp stamp-finished">FINISHED<br/>${formatVintageDate(rawFinished)}</span></div>`;
  }

  // 2. Interactive Stars HTML
  let starsHtml = `<div id="details-stars" style="display: flex; gap: 4px; font-size: 24px; margin-bottom: 5px;">`;
  for (let i = 1; i <= 5; i++) {
    starsHtml += `<span data-value="${i}" style="color: ${i <= ratingNum ? '#DDA750' : '#e0dcd3'}; cursor:pointer; transition: transform 0.1s;">★</span>`;
  }
  starsHtml += `</div>`;

  // 3. Inject Layout HTML (With Pencil Icons and Magic Wand)
  const pencilSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;

  journalContent.innerHTML = `
    <div style="display: flex; gap: 20px; align-items: flex-start; width: 100%; text-align: left; margin-bottom: 10px;">
      <img src="${coverUrl}" style="width: 110px; border-radius: 6px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); flex-shrink: 0;" onerror="this.src='https://placehold.co/60x90?text=No+Cover'">
      <div style="flex-grow: 1; min-width: 0;">
        <h2 style="font-family: 'Georgia', serif; font-size: 1.25rem; font-weight: bold; color: var(--text-dark); margin: 0 0 4px 0; line-height: 1.2; overflow-wrap: break-word;">${title}</h2>
        <p style="font-family: 'Courier New'; font-size: 0.9rem; color: var(--sage-green); margin: 0 0 10px 0;">by ${author}</p>
        ${starsHtml}
        ${stampsHtml}
      </div>
    </div>

    <div style="display: flex; gap: 15px; width: 100%; margin-bottom: 25px;">
      
      <div class="journal-meta-card" style="flex-grow: 1;">
        <div class="meta-row">
          <span class="meta-label">Status:</span> 
          <div class="input-with-icon">
            <select id="inline-status" class="inline-edit-input">
              <option value="0" ${statusNum === '0' ? 'selected' : ''}>TBR</option>
              <option value="1" ${statusNum === '1' ? 'selected' : ''}>Reading</option>
              <option value="2" ${statusNum === '2' ? 'selected' : ''}>Finished</option>
              <option value="3" ${statusNum === '3' ? 'selected' : ''}>Gave Up</option>
            </select>
            ${pencilSvg}
          </div>
        </div>
        <div class="meta-row">
          <span class="meta-label">Added:</span> 
          <div class="input-with-icon">
            <span class="meta-value" style="font-weight: bold;">${dateAdded}</span>
            <svg width="14" height="14" style="opacity: 0;"></svg> </div>
        </div>
        <div class="meta-row">
          <span class="meta-label">Started:</span> 
          <div class="input-with-icon">
            <input type="date" id="inline-started" class="inline-edit-input" value="${startedVal}">
            ${pencilSvg}
          </div>
        </div>
        <div class="meta-row">
          <span class="meta-label">Finished:</span> 
          <div class="input-with-icon">
            <input type="date" id="inline-finished" class="inline-edit-input" value="${finishedVal}">
            ${pencilSvg}
          </div>
        </div>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 10px; justify-content: space-between; margin-top: 15px;">
        <button id="btn-refresh-book" class="journal-action-btn" title="Refresh Data">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
          </svg>
        </button>
        <button id="btn-read-again" class="journal-action-btn" title="Read Again">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
        </button>
        <button id="btn-delete-book" class="journal-action-btn" title="Return/Delete">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>

    <div style="width: 100%; text-align: left;">
      <h3 style="font-family: 'Courier New'; color: var(--terracotta); margin: 0 0 10px 0; font-size: 1rem;">Notes</h3>
      <div style="position: relative;">
        <textarea id="journal-notes-area" class="journal-notes-input" placeholder="Tap to add your thoughts...">${notes}</textarea>
        <button id="btn-save-notes" style="position: absolute; bottom: 12px; right: 12px; background: var(--terracotta); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-family: 'Courier New'; font-weight: bold; cursor: pointer; display: none;">Save</button>
      </div>
    </div>
  `;
  
  pageViews.forEach(view => view.classList.remove('active'));
  const detailsContainer = document.getElementById('view-details');
    if (detailsContainer) {
      detailsContainer.classList.add('active');

      // Add this to force the reading journal to start at the top
      detailsContainer.scrollTop = 0;
    }

  // ==========================================
  // CLOSE BOOK DETAILS LOGIC
  // ==========================================
  function closeBookDetails() {
    const detailsContainer = document.getElementById('view-details'); 
  
    if (detailsContainer) {
      detailsContainer.classList.remove('active'); 
    }
    
    // Safely route back to whatever view Sarah was previously on!
    const previousView = document.getElementById(lastActiveTab);
    if (previousView) {
      previousView.classList.add('active'); 
    } else {
      // Fallback just in case something goes wrong
      document.getElementById('view-library').classList.add('active'); 
    }
  
    currentOpenBookId = null; 
  }

  // ==========================================
  // 4. ATTACH INTERACTIVE EVENT LISTENERS
  // ==========================================
  
  // A. Inline Edits (Status & Dates)
  document.getElementById('inline-status').addEventListener('change', async (e) => {
    const newStatus = parseInt(e.target.value);
    const updatedBook = globalLibraryData.find(b => b.uuid === currentOpenBookId);
    
    await updateBookData('status', newStatus);
    updatedBook.status = newStatus; 
    
    const todayIso = new Date().toISOString();
    
    if (newStatus === 1) { // Reading
      // ALWAYS update to today's date when switching to Reading
      await updateBookData('date_started', todayIso);
      updatedBook.date_started = todayIso;
      
      // Clear finish date if moved back to Reading
      await updateBookData('read_date', null);
      updatedBook.read_date = null;
      
    } else if (newStatus === 2) { // Finished
      await updateBookData('read_date', todayIso);
      updatedBook.read_date = todayIso;
    }
    
    // Instantly update the Hero Carousel!
    if (typeof renderHeroSection === 'function') renderHeroSection();
    if (typeof calculateStats === 'function') calculateStats();
    
    openDetails(updatedBook); 
    applyLibraryFilters(); 
  });

  document.getElementById('inline-started').addEventListener('change', async (e) => {
    const updatedBook = globalLibraryData.find(b => b.uuid === currentOpenBookId);
    const rawInput = e.target.value;
    
    if (!rawInput) {
      await updateBookData('date_started', null);
      updatedBook.date_started = null;
    } else {
      // Parse locally to avoid UTC off-by-one errors
      const [year, month, day] = rawInput.split('-');
      const isoString = new Date(year, month - 1, day).toISOString();
      await updateBookData('date_started', isoString);
      updatedBook.date_started = isoString;
    }
    openDetails(updatedBook);
  });

  document.getElementById('inline-finished').addEventListener('change', async (e) => {
    const updatedBook = globalLibraryData.find(b => b.uuid === currentOpenBookId);
    const rawInput = e.target.value;

    if (!rawInput) {
      await updateBookData('read_date', null);
      updatedBook.read_date = null;
    } else {
      const [year, month, day] = rawInput.split('-');
      const newDateObj = new Date(year, month - 1, day);
      
      const today = new Date();
      today.setHours(23, 59, 59, 999); 

    const startedInput = document.getElementById('inline-started').value;
    let startedDateObj = null;
    if (startedInput) {
       const [sYear, sMonth, sDay] = startedInput.split('-');
       startedDateObj = new Date(sYear, sMonth - 1, sDay);
    }

    // Validations
    if (newDateObj > today) {
      alert("Finished date cannot be in the future.");
      e.target.value = updatedBook.read_date ? updatedBook.read_date.split('T')[0] : '';
      return;
    }
    
    if (startedDateObj && newDateObj < startedDateObj) {
      alert("Finished date cannot be before the Started date.");
      e.target.value = updatedBook.read_date ? updatedBook.read_date.split('T')[0] : '';
      return;
    }

    const isoString = newDateObj.toISOString();
    await updateBookData('read_date', isoString);
    updatedBook.read_date = isoString;

    // Auto-update status to Finished
    await updateBookData('status', 2);
    updatedBook.status = 2;
  }

    if (typeof renderHeroSection === 'function') renderHeroSection();
    if (typeof calculateStats === 'function') calculateStats();

    openDetails(updatedBook);
    applyLibraryFilters();
  });

  // B. Editable Stars
  const starElements = document.querySelectorAll('#details-stars span');
  starElements.forEach(star => {
    star.addEventListener('click', async (e) => {
      const newValue = parseInt(e.target.getAttribute('data-value'));
      
      starElements.forEach(s => {
        const val = parseInt(s.getAttribute('data-value'));
        s.style.color = val <= newValue ? '#DDA750' : '#e0dcd3';
        s.style.transform = val === newValue ? 'scale(1.2)' : 'scale(1)';
        setTimeout(() => s.style.transform = 'scale(1)', 150);
      });

      await updateBookData('rating', newValue);
      applyLibraryFilters(); 
    });
  });

  // C. Notes
  const notesArea = document.getElementById('journal-notes-area');
  const saveNotesBtn = document.getElementById('btn-save-notes');
  
  notesArea.addEventListener('input', () => saveNotesBtn.style.display = 'block');

  saveNotesBtn.addEventListener('click', async () => {
    saveNotesBtn.textContent = 'Saved!';
    saveNotesBtn.style.background = 'var(--sage-green)';
    
    await updateBookData('notes', notesArea.value);
    
    setTimeout(() => {
      saveNotesBtn.style.display = 'none';
      saveNotesBtn.textContent = 'Save';
      saveNotesBtn.style.background = 'var(--terracotta)';
    }, 1500);
  });

  // D. Action Buttons
  document.getElementById('btn-refresh-book').addEventListener('click', async (e) => 
    {
    const btn = e.currentTarget;
    btn.style.opacity = '0.5';
    
    const isbn = getField(book, 'isbn');
    const qTitle = getField(book, 'title') || '';
    const qAuthor = getField(book, 'author') || '';
    let query = '';
    
    const cleanIsbn = String(isbn).replace(/[-\s]/g, '');
    if (cleanIsbn && cleanIsbn !== 'N/A' && cleanIsbn !== 'undefined') {
      query = `isbn:${cleanIsbn}`;
    } else {
      query = `intitle:${qTitle.replace(/ /g, '+')}+inauthor:${qAuthor.replace(/ /g, '+')}`;
    }

    try {
      const apiKey = 'AIzaSyD8cH6KE9JXatD9t0tyc6QETNMrtJP-Pt4';
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${query}&key=${apiKey}`);
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        const volumeInfo = data.items[0].volumeInfo;
        if (volumeInfo.imageLinks?.thumbnail) await updateBookData('cover_url', volumeInfo.imageLinks.thumbnail.replace('http:', 'https:'));
        if (volumeInfo.pageCount) await updateBookData('pages', volumeInfo.pageCount);
        if (volumeInfo.categories?.length > 0) await updateBookData('category', volumeInfo.categories[0]);
        
        const updatedBook = globalLibraryData.find(b => b.uuid === currentOpenBookId);
        openDetails(updatedBook);
        applyLibraryFilters();
      }
    } catch (error) {
      console.error(error);
    } finally {
      btn.style.opacity = '1';
    }
  });

  document.getElementById('btn-read-again').addEventListener('click', async () => {
    const userConfirmed = await showStacksModal("Read Again", "Start a new reading journey for this book? This duplicates the entry so you can log new dates and notes.", true);
    
    if (userConfirmed) {
      const duplicate = {
        uuid: crypto.randomUUID(),
        title: getField(book, 'title'),
        author: getField(book, 'author'),
        isbn: getField(book, 'isbn'),
        cover_url: getField(book, 'cover_url'),
        pages: getField(book, 'pages'),
        category: getField(book, 'category'),
        status: 1, 
        date_started: new Date().toISOString(),
        read_date: null,
        rating: 0,
        notes: null
      };
      
      const { data, error } = await supabase.from('books').insert([duplicate]).select();
      
      if (error) {
        console.error('Error duplicating:', error);
        await showStacksModal("Error", "Oops! Something went wrong communicating with the database.", false);
      } else {
        globalLibraryData.push(data[0] || duplicate);
        
        if (typeof renderHeroSection === 'function') renderHeroSection();
        if (typeof calculateStats === 'function') calculateStats();
        applyLibraryFilters(); 
        
        await showStacksModal("Success", "New journey added! Check your Current Reads.", false);
        closeBookDetails();
      }
    }
  });

  document.getElementById('btn-delete-book').addEventListener('click', async () => {
    const userConfirmed = await showStacksModal("Delete Book", "Are you sure you want to delete this book?", true);
    
    if (userConfirmed) {
      const { error } = await supabase.from('books').delete().eq('uuid', book.uuid);
  
      if (error) {
        await showStacksModal("Error", "Could not delete the book. Please try again.", false);
        return;
      }
  
      globalLibraryData = globalLibraryData.filter(b => b.uuid !== book.uuid);
      loadBooks();
      closeBookDetails();
    }
  });

  // Ensure the Close button functions cleanly without memory leaks
  if (closeDetailsBtn) {
    closeDetailsBtn.onclick = () => {
      closeBookDetails(); 
    };
  }
} // <--- This final bracket safely closes the master openDetails() function!


// ==========================================
// 5. SEARCH & BARCODE SCANNER LOGIC
// ==========================================

const startScanBtn = document.getElementById('start-scan-btn');
const stopScanBtn = document.getElementById('stop-scan-btn');
const scannerContainer = document.getElementById('scanner-container');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
let html5QrcodeScanner;

if (startScanBtn) {
  startScanBtn.addEventListener('click', () => {
    scannerContainer.classList.remove('hidden');
    html5QrcodeScanner = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 };

    html5QrcodeScanner.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        html5QrcodeScanner.stop().then(() => {
          scannerContainer.classList.add('hidden');
          searchInput.value = `${decodedText}`;
          if(searchBtn) searchBtn.click();
        });
      },
      (err) => { /* Ignore constant read errors */ }
    ).catch((err) => {
      console.error("Camera access denied or error:", err);
      alert("Could not access the camera. Please ensure permissions are granted.");
      scannerContainer.classList.add('hidden');
    });
  });
}

if (stopScanBtn) {
  stopScanBtn.addEventListener('click', () => {
    if (html5QrcodeScanner) {
      html5QrcodeScanner.stop().then(() => scannerContainer.classList.add('hidden')).catch(err => console.error(err));
    }
  });
}

async function searchGoogleBooks(query) {
  if (!query) return;

  if(searchResultsContainer) searchResultsContainer.innerHTML = '<p style="text-align:center; color: var(--sage-green); font-family: Courier New;">Searching the archives...</p>';

  try {
    const apiKey = 'AIzaSyD8cH6KE9JXatD9t0tyc6QETNMrtJP-Pt4'; 
    const typeRadio = document.querySelector('input[name="search-type"]:checked');
    const searchType = typeRadio ? typeRadio.value : 'intitle:';
    
    // --- SEARCH WITHOUT TITLE OR AUTHOR ---
    let finalQuery = '';
    const cleanString = query.trim();
    const numbersOnly = cleanString.replace(/[-\s]/g, '');

    // 1. If the query already starts with "isbn:" (typed manually)
    if (cleanString.toLowerCase().startsWith('isbn:')) {
      finalQuery = encodeURIComponent(cleanString);
    } 
    // 2. If it's purely a 10 or 13 digit number, force the "isbn:" prefix
    else if (/^\d{10}(\d{3})?$/.test(numbersOnly)) {
      finalQuery = encodeURIComponent(`isbn:${numbersOnly}`);
    } 
    // 3. Otherwise, perform a broad keyword search!
    else {
      finalQuery = encodeURIComponent(cleanString);
    }
    
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${finalQuery}&maxResults=10&key=${apiKey}`);
    
    const data = await response.json();

    if(searchResultsContainer) searchResultsContainer.innerHTML = '';

    document.getElementById('search-results-header').classList.remove('hidden');

    if (!data.items || data.items.length === 0) {
      if(searchResultsContainer) searchResultsContainer.innerHTML = '<p style="text-align:center; color: var(--sage-green); font-family: Courier New;">No books found. Try a different search.</p>';
      return;
    }

    data.items.forEach(item => {
      const info = item.volumeInfo;
      const title = info.title || 'Unknown Title';
      const author = info.authors ? info.authors.join(', ') : 'Unknown Author';
      const category = info.categories ? info.categories[0] : 'Uncategorized';
      const thumbnail = info.imageLinks?.thumbnail ? info.imageLinks.thumbnail.replace('http:', 'https:') : 'https://placehold.co/60x90?text=No+Cover';
      const infoLink = info.infoLink || '#';
      
      let isbn = '';
      if (info.industryIdentifiers) {
        const isbnObj = info.industryIdentifiers.find(id => id.type === 'ISBN_13') || info.industryIdentifiers.find(id => id.type === 'ISBN_10');
        if (isbnObj) isbn = isbnObj.identifier;
      }

      const card = document.createElement('div');
      card.className = 'search-result-card';
      
      card.innerHTML = `
        <img src="${thumbnail}" alt="Cover" style="width: 60px; height: 90px; object-fit: cover; border-radius: 2px;">
        <div class="search-result-info">
          <h3>${title}</h3>
          <p>${author}</p>
          <button class="add-book-btn" 
            data-title="${encodeURIComponent(title)}" 
            data-author="${encodeURIComponent(author)}" 
            data-isbn="${encodeURIComponent(isbn)}" 
            data-category="${encodeURIComponent(category)}"
            data-cover="${encodeURIComponent(thumbnail)}">+ Add</button>
          <a href="${infoLink}" target="_blank" class="google-books-link">View on Google Books ↗</a>
        </div>
      `;

      if(searchResultsContainer) searchResultsContainer.appendChild(card);
    });

    // Add Book Listeners
    document.querySelectorAll('.add-book-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const button = e.target;
        button.textContent = 'Saving...';
        button.style.backgroundColor = 'var(--terracotta)';
        button.disabled = true;
        
        const schema = globalLibraryData.length > 0 ? Object.keys(globalLibraryData[0]) : [];
        const getKey = (name) => schema.find(k => k.toLowerCase() === name.toLowerCase()) || name;

        const payload = {};
        payload[getKey('uuid')] = crypto.randomUUID();
        payload[getKey('title')] = decodeURIComponent(button.dataset.title);
        payload[getKey('author')] = decodeURIComponent(button.dataset.author);
        payload[getKey('status')] = 0; // Default to Waiting
        payload[getKey('isbn')] = decodeURIComponent(button.dataset.isbn);
        payload[getKey('category')] = decodeURIComponent(button.dataset.category);
        payload[getKey('cover_url')] = decodeURIComponent(button.dataset.cover);

        // Database Insert
        const { data, error } = await supabase.from('books').insert([payload]).select();

        if (error) {
          console.error('Error adding book:', error);
          button.textContent = 'Error!';
        } else {
          button.textContent = 'Saved!';
          button.style.backgroundColor = 'var(--sage-green)';
          
          if (data && data.length > 0) {
            const savedBook = data[0];
            globalLibraryData.push(savedBook);
            
            // Auto-open card and refresh grid
            setTimeout(() => { openDetails(savedBook); }, 600);
            loadBooks(); 
          }
        }
      });
    });
  } catch (error) {
    console.error("Search failed:", error);
    if(searchResultsContainer) searchResultsContainer.innerHTML = '<p style="text-align:center; color: #a34e4e;">Something went wrong. Please try again.</p>';
  }
}

if (searchBtn) searchBtn.addEventListener('click', () => searchGoogleBooks(searchInput.value));
if (searchInput) {
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchGoogleBooks(searchInput.value);
  });
}


// ==========================================
// 6. FOCUS TIMER & AUDIO
// ==========================================

const timerDisplay = document.getElementById('timer-display');
const playPauseBtn = document.getElementById('play-pause-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const focusDurationSelect = document.getElementById('focus-duration');
const focusCloseBtn = document.getElementById('focus-close-btn');
const sound = new Audio('uplifting-bells.wav');

let focusInterval;
let timeRemaining = 1200; // Default 20 mins
let isTimerRunning = false;
let audioCtx; 

function updateTimerDisplay() {
  const mins = Math.floor(timeRemaining / 60);
  const secs = timeRemaining % 60;
  if(timerDisplay) timerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

if(playPauseBtn) {
  playPauseBtn.addEventListener('click', () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (isTimerRunning) {
      clearInterval(focusInterval);
      isTimerRunning = false;
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      timerDisplay.style.color = "var(--text-dark)";
    } else {
      if (timeRemaining <= 0) timeRemaining = parseInt(focusDurationSelect.value);
      isTimerRunning = true;
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
      timerDisplay.style.color = "var(--sage-green)"; 
      
      focusInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        
        if (timeRemaining <= 0) {
          clearInterval(focusInterval);
          isTimerRunning = false;
          playIcon.style.display = 'block';
          pauseIcon.style.display = 'none';
          timerDisplay.style.color = "var(--text-dark)";
          playCozyChime(); 
        }
      }, 1000);
    }
  });
}

if (focusDurationSelect) {
  focusDurationSelect.addEventListener('change', () => {
    clearInterval(focusInterval);
    isTimerRunning = false;
    if(playIcon) playIcon.style.display = 'block';
    if(pauseIcon) pauseIcon.style.display = 'none';
    if(timerDisplay) timerDisplay.style.color = "var(--text-dark)";
    
    timeRemaining = parseInt(focusDurationSelect.value);
    updateTimerDisplay();
  });
}

function playCozyChime() {
  sound.play();
}

if (focusCloseBtn) {
  focusCloseBtn.addEventListener('click', () => {
    const prevNavBtn = document.querySelector(`.nav-item[data-target="${previousViewId}"]`);
    if (prevNavBtn) prevNavBtn.click();
  });
}


// ==========================================
// 7. NAVIGATION & SYSTEM
// ==========================================

const navItems = document.querySelectorAll('.nav-item');
const pageViews = document.querySelectorAll('.page-view');
let previousViewId = 'view-library'; 

// --- BATCH 8: HEADER & FEEDBACK LOGIC ---

// 1. Header Scroll-to-Top
const headerScrollTrigger = document.getElementById('header-scroll-trigger');
if (headerScrollTrigger) {
  headerScrollTrigger.addEventListener('click', () => {
    const activeView = document.querySelector('.page-view.active');
    if (activeView) activeView.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ==========================================
// FEEDBACK MODAL LOGIC
// ==========================================
const feedbackModal = document.querySelector('.feedback-modal');
const feedbackTriggerBtn = document.getElementById('feedback-trigger-btn');
const closeXBtn = document.querySelector('.close-modal');
const closeFeedbackBtn = document.getElementById('close-feedback-btn');
const submitFeedbackBtn = document.getElementById('submit-feedback-btn');
const feedbackText = document.getElementById('feedback-text');

if (feedbackModal && feedbackTriggerBtn) {
  // 1. Open the modal
  feedbackTriggerBtn.addEventListener('click', () => {
    feedbackModal.classList.remove('hidden');
  });

  // 2. Reusable Close Function
  const closeModal = () => {
    feedbackModal.classList.add('hidden');
    if (feedbackText) feedbackText.value = ''; // Clear text on close
  };

  // Wire up the 'X' and 'Cancel' buttons
  if (closeXBtn) closeXBtn.addEventListener('click', closeModal);
  if (closeFeedbackBtn) closeFeedbackBtn.addEventListener('click', closeModal);

  // Close by tapping the blurred background
  feedbackModal.addEventListener('click', (e) => {
    if (e.target === feedbackModal) closeModal();
  });

  // 3. Submit Logic to Supabase
  if (submitFeedbackBtn) {
    submitFeedbackBtn.addEventListener('click', async () => {
      const text = feedbackText.value.trim();
      if (!text) return;

      // UI Feedback state
      const originalText = submitFeedbackBtn.textContent;
      submitFeedbackBtn.textContent = 'Sending...';
      submitFeedbackBtn.disabled = true;

      // Send to Supabase
      const { error } = await supabase
        .from('feedback')
        .insert([{ message: text }]);

      if (error) {
        console.error('Error sending feedback:', error);
        submitFeedbackBtn.textContent = 'Error!';
        submitFeedbackBtn.style.backgroundColor = '#a34e4e'; // Turn red on error
      } else {
        submitFeedbackBtn.textContent = 'Sent!';
        submitFeedbackBtn.style.backgroundColor = 'var(--sage-green)';
        
        // Reset and close after a brief delay
        setTimeout(() => {
          closeModal();
          submitFeedbackBtn.textContent = originalText;
          submitFeedbackBtn.style.backgroundColor = 'var(--terracotta)';
          submitFeedbackBtn.disabled = false;
        }, 1500);
      }
    });
  }
}

// 1. Create a global cache to remember scroll positions
const scrollCache = {};

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetId = item.getAttribute('data-target');

    // 2. Save the scroll position of the current tab BEFORE switching
    const currentActive = document.querySelector('.page-view.active');
    if (currentActive && currentActive.id !== 'view-focus') {
      scrollCache[currentActive.id] = currentActive.scrollTop;
      previousViewId = currentActive.id;
    }

    lastActiveTab = targetId;
    window.history.replaceState({ level: 'main' }, '');
        
    navItems.forEach(btn => btn.classList.remove('active'));
    item.classList.add('active');

    pageViews.forEach(view => view.classList.remove('active'));
    const targetView = document.getElementById(targetId);
    
    if(targetView) {
      targetView.classList.add('active');
      
      // 3. Restore the scroll position for the incoming tab!
      targetView.scrollTop = scrollCache[targetId] || 0;
    }
    
    if (topFab) topFab.classList.remove('visible');
    if (sheet && sheet.classList.contains('open')) sheet.classList.remove('open');
  });
});

if (topFab) {
  // Listen to the individual views instead of the bookshelf
  pageViews.forEach(view => {
    view.addEventListener('scroll', () => {
      if (view.scrollTop > 300) topFab.classList.add('visible');
      else topFab.classList.remove('visible');
    });
  });

  topFab.addEventListener('click', () => {
    // Scroll the currently active view
    const activeView = document.querySelector('.page-view.active');
    if (activeView) activeView.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// 1. History API & Context Routing
let lastActiveTab = 'view-library'; // Default

// Ensure nav clicks ALWAYS update the origin tracker
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', (e) => {
    lastActiveTab = e.currentTarget.getAttribute('data-target');
  });
});

// ==========================================
// 9. PHASE 1: WANDER DRAWER LOGIC
// ==========================================

const wanderTriggerBtn = document.getElementById('wander-trigger-btn');
const wanderSheet = document.getElementById('wander-sheet');
const statusFilterSelect = document.getElementById('filter-status');
const sortLibrarySelect = document.getElementById('sort-library');
const applyWanderBtn = document.getElementById('apply-wander-btn');
const clearWanderBtn = document.getElementById('clear-wander-btn');
const localSearchInput = document.getElementById('local-search');
const clearSearchBtn = document.getElementById('clear-search-btn');

if (wanderTriggerBtn && wanderSheet) {
  wanderTriggerBtn.addEventListener('click', () => wanderSheet.classList.add('open'));
  const wanderHandle = wanderSheet.querySelector('.sheet-handle');
  if (wanderHandle) wanderHandle.addEventListener('click', () => wanderSheet.classList.remove('open'));
  
  // ==========================================
  // WANDER DRAWER INTERACTION LOGIC
  // ==========================================
  const quickBtns = document.querySelectorAll('.quick-btn, .filter-btn');
  
  // 1. Quick Filter Button Clicks
  quickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      libraryYearFilter = 'all'; 
      
      quickBtns.forEach(b => {
        b.classList.remove('active');
        b.style.background = '';
        b.style.color = '';
      });

      document.querySelectorAll('.hero-pill-btn').forEach(b => b.classList.remove('active'));
      
      // Highlight the clicked button
      btn.classList.add('active');

      // Instantly apply the filter and elegantly close the drawer
      applyLibraryFilters(); 
      wanderSheet.classList.remove('open');
      const activeView = document.querySelector('.page-view.active');
      if (activeView) activeView.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  
  // 2. "Wander" (Apply) Logic
  if (applyWanderBtn) {
    applyWanderBtn.addEventListener('click', () => {
      applyLibraryFilters(); 
      wanderSheet.classList.remove('open');
      const activeView = document.querySelector('.page-view.active');
      if (activeView) activeView.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  
  // 3. "Clear" Defaults Logic
  if (clearWanderBtn) {
    clearWanderBtn.addEventListener('click', () => {
      if (localSearchInput) localSearchInput.value = '';
      
      libraryYearFilter = 'all';
      
      quickBtns.forEach(b => {
        b.classList.remove('active');
        b.style.background = '';
        b.style.color = '';
      });

      document.querySelectorAll('.hero-pill-btn').forEach(b => b.classList.remove('active'));
  
      applyLibraryFilters();
      wanderSheet.classList.remove('open');
      const activeView = document.querySelector('.page-view.active');
      if (activeView) activeView.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

// ==========================================
// 10. PHASE 2: JOURNEY VIEW TOGGLES
// ==========================================

const layoutBtns = document.querySelectorAll('.layout-btn');
const mainGrid = document.getElementById('book-grid');
let currentLayout = localStorage.getItem('stacksLayout') || 'layout-grid';

if (layoutBtns.length > 0 && mainGrid) {
  layoutBtns.forEach(b => {
    b.classList.remove('active');
    if (b.getAttribute('data-layout') === currentLayout) {
      b.classList.add('active');
    }
  });

  layoutBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      layoutBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      currentLayout = btn.getAttribute('data-layout');
      localStorage.setItem('stacksLayout', currentLayout);
      
      mainGrid.className = 'book-grid ' + currentLayout;
      mainGrid.style.opacity = 0;
      setTimeout(() => { mainGrid.style.opacity = 1; }, 50);
    });
  });
}

// ==========================================
// NAVIGATION AND GESTURE FIXES
// ==========================================

// 1. Initial Setup: The "Double-Lock"
// Replace current state with a trap, then push the main state.
window.history.replaceState({ level: 'trap' }, '');
window.history.pushState({ level: 'main' }, '');

window.addEventListener('popstate', (event) => {
  // Delay the re-trap so native animations finish smoothly
  setTimeout(() => {
    window.history.pushState({ level: 'main' }, '');
  }, 300);

  // A. Close Custom System Modal (if open)
  const modalOverlay = document.getElementById('stacks-modal-overlay');
  if (modalOverlay && !modalOverlay.classList.contains('hidden')) {
    const cancelBtn = document.getElementById('stacks-modal-cancel');
    if (cancelBtn && cancelBtn.style.display !== 'none') {
      cancelBtn.click(); 
    } else {
      modalOverlay.classList.add('hidden');
    }
    return; 
  }

  // B. Close Feedback Modal (if open)
  const feedbackModal = document.querySelector('.feedback-modal');
  if (feedbackModal && !feedbackModal.classList.contains('hidden')) {
    feedbackModal.classList.add('hidden');
    return;
  }

  // C. Close Wander Drawer (if open)
  const wanderSheet = document.getElementById('wander-sheet');
  if (wanderSheet && wanderSheet.classList.contains('open')) {
    wanderSheet.classList.remove('open');
    return;
  }

  // D. Close Details View (The Reading Journal)
  const viewDetails = document.getElementById('view-details');
  if (viewDetails && viewDetails.classList.contains('active')) {
    const closeDetailsBtn = document.getElementById('close-details-btn');
    if (closeDetailsBtn) closeDetailsBtn.click(); 
    return;
  }

  // E. Return to Library View from other main tabs
  // (Optional: You can remove this block entirely if you want swiping back on Stats/Focus to just do nothing instead of jumping back to the Library)
  const libraryView = document.getElementById('view-library');
  if (libraryView && !libraryView.classList.contains('active')) {
    const libraryNav = document.querySelector('.nav-item[data-target="view-library"]');
    if (libraryNav) libraryNav.click();
  }
});

// 2. Restore Wander Drawer Swipe-to-Close
let touchStartY = 0;
let touchCurrentY = 0;
let isSwiping = false;

const wanderSheetEl = document.getElementById('wander-sheet');

if (wanderSheetEl) { 
  wanderSheetEl.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
    isSwiping = true;
    wanderSheetEl.style.transition = 'none'; 
  }, { passive: true });

  wanderSheetEl.addEventListener('touchmove', (e) => {
    if (!isSwiping) return;
    touchCurrentY = e.touches[0].clientY;
    const deltaY = touchCurrentY - touchStartY;
    if (deltaY > 0) { 
      wanderSheetEl.style.transform = `translateY(${deltaY}px)`;
    }
  }, { passive: true });

  wanderSheetEl.addEventListener('touchend', () => {
    if (!isSwiping) return;
    isSwiping = false;
    const deltaY = touchCurrentY - touchStartY;
    
    wanderSheetEl.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    wanderSheetEl.style.transform = ''; 

    if (deltaY > 80) {
      wanderSheetEl.classList.remove('open');
    }
  });
}
