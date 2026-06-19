import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// =========================================================================
// MODULE 1: APP INITIALIZATION & DATABASE CLIENT
// =========================================================================

// Connect to the Supabase Database using client credentials
const supabaseUrl = 'https://jvsjzlvabtffhsnvmcto.supabase.co';
const supabaseKey = 'sb_publishable_H2EPwvAaziQVz8T4yExdEw_bQrB5f3V';
const supabase = createClient(supabaseUrl, supabaseKey);

// Global Caches and Application State Parameters
let globalLibraryData = [];
let libraryYearFilter = 'all'; // Tracks if the library is currently filtered by a specific year
let currentOpenBookId = null;
let returnViewId = 'view-library';
let lastActiveTab = 'view-library';
let previousViewId = 'view-library';
const scrollCache = {}; 

// Cache common DOM targets to minimize layout thrashing
const bookGrid = document.getElementById('book-grid');
const sheet = document.querySelector('.bottom-sheet:not(#wander-sheet)');
const topFab = document.getElementById('top-fab'); 
const pageViews = document.querySelectorAll('.page-view');
const navItems = document.querySelectorAll('.nav-item');
const searchResultsContainer = document.getElementById('search-results-container');

// =========================================================================
// MODULE 2: USER AUTHENTICATION & INITIAL LIFE CYCLE
// =========================================================================

// Runs immediately on window load to authenticate Sarah and configure loading screen timers
window.addEventListener('load', async () => {
  const loadingVideo = document.getElementById('loading-video');
  const loadingScreen = document.getElementById('loading-screen');
  const authScreen = document.getElementById('auth-screen');
  const skipBtn = document.getElementById('skip-loading-btn');
  
  if (loadingVideo) loadingVideo.playbackRate = 1.5; 

  // 1. Silent login checking
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    loadBooks(); // User is logged in, preload database silently in the background
  } else {
    // User is not logged in, prepare login card under the veil
    if (authScreen) authScreen.classList.remove('hidden');
  }

  // 2. Cinematic Loading Screen Triggers
  const videoFadeTime = 2000; 
  const backgroundFadeTime = 3000; 

  const fadeOutLoading = () => {
    if (loadingVideo) loadingVideo.style.opacity = '0';
    setTimeout(() => {
      if (loadingScreen) loadingScreen.classList.add('hidden');
    }, 1000);
  };

  // Run normal timeout sequence
  const fallbackTimeout = setTimeout(fadeOutLoading, backgroundFadeTime);
  const videoTimeout = setTimeout(() => {
    if (loadingVideo) loadingVideo.style.opacity = '0';
  }, videoFadeTime);

  // Wire up skip button to bypass cinematic timeouts immediately
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      clearTimeout(fallbackTimeout);
      clearTimeout(videoTimeout);
      fadeOutLoading();
    });
  }
});

// Authenticate user via Supabase and route to library dashboard
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
    loginBtn.textContent = "Let's go!";
  } else {
    document.getElementById('auth-screen').classList.add('hidden');
    loadBooks(); 
  }
});

// =========================================================================
// MODULE 3: THE MAIN LIBRARY VIEW (THE DASHBOARD)
// =========================================================================

// Renders the Hero shelf displaying active reading carousels or action pills
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
    card.addEventListener('click', () => navigateToQuickFilter('2', 'rating_desc')); 
    return card;
  };

  const activeReads = globalLibraryData.filter(b => Number(getField(b, 'status')) === 1);

  // SCENARIO 0: No Active Reads (Renders action pill shortcuts)
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
      document.querySelectorAll('.hero-pill-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.quick-btn, .filter-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#wander-sheet select').forEach(select => select.selectedIndex = 0);
      libraryYearFilter = 'all';
      window.lastAppliedSort = 'title_asc'; 
      applyLibraryFilters();
      document.querySelector('.nav-item[data-target="view-search"]').click();
    });

    const tbrPill = document.createElement('button');
    tbrPill.className = 'hero-pill-btn';
    tbrPill.innerHTML = `TBR List`;
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

  // SCENARIO 3+: 3 or more Active Reads (Scrollable Carousel with a "See All" trigger)
  } else {
    heroLabel.textContent = "Current Reads";
    const displayReads = activeReads.slice(0, 3); 

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

  // Floating horizontal scroll arrow indicators
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

// Master book fetching initiator (Preloads database cache on login/refresh)
async function loadBooks() {
  const { data: books, error } = await supabase
    .from('books')
    .select('*')
    .order('title', { ascending: true });

  if (error) { console.error(error); return; }
  
  globalLibraryData = books; 
  calculateStats(); 
  renderHeroSection();
  applyLibraryFilters();
  initStatsPage(); 
  renderAnnualStats(document.getElementById('stats-year-select').value);
}

// Renders the main book catalog using user's layout preferences (Grid, Cards, List)
function renderGrid(booksToRender) {
  if (!bookGrid) return;
  bookGrid.innerHTML = '';

  const activeLayout = localStorage.getItem('stacksLayout') || 'layout-grid';
  bookGrid.className = `book-grid ${activeLayout}`;

  // EMPTY STATE
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

  const sortMethod = window.lastAppliedSort || '';
  let currentRenderYear = null;

  for (const book of booksToRender) {
    // Inject chronological indicators if sorting by finished date
    const bookStatus = Number(getField(book, 'status'));
    const bookReadDate = getField(book, 'read_date') || getField(book, 'date_finished');
    if (sortMethod === 'date_finished_desc' && bookStatus === 2 && bookReadDate) {
      const bookYear = String(bookReadDate).split('-')[0]; 
      
      if (bookYear !== currentRenderYear) {
        currentRenderYear = bookYear;
        const divider = document.createElement('div');
        divider.className = 'year-divider';
        divider.id = `year-header-${currentRenderYear}`; 
        divider.textContent = currentRenderYear;
        bookGrid.appendChild(divider);
      }
    }

    const bookDiv = document.createElement('div');
    bookDiv.className = 'book-card'; 
    
    if (typeof currentOpenBookId !== 'undefined' && book.uuid === currentOpenBookId && viewDetails && viewDetails.classList.contains('active')) {
       bookDiv.classList.add('active');
    }
    
    const savedCover = getField(book, 'cover_url');
    const isbn = getField(book, 'isbn');
    const title = getField(book, 'title') || 'Unknown Title';
    const author = getField(book, 'author') || 'Unknown Author';
    const ratingNum = Number(getField(book, 'rating')) || 0;
    
    let ratingDisplay = '<span style="color: #b3bfae; font-size: 11px; font-family: \'Courier New\';">No Rating</span>';
    if (ratingNum > 0) {
      ratingDisplay = '★'.repeat(ratingNum) + '<span style="color: #e0dcd3;">' + '★'.repeat(5 - ratingNum) + '</span>';
    }

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

  // Setup Lazy image loader intersections
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

// Adjusts the Back to Top FAB display based on active panel scroll coordinates
function updateFabVisibility() {
  if (!topFab) return;
  const activeView = document.querySelector('.page-view.active');
  if (activeView && activeView.id !== 'view-focus' && activeView.id !== 'view-details' && activeView.scrollTop > 300) {
    topFab.classList.add('visible');
  } else {
    topFab.classList.remove('visible');
  }
}

// Layout Switchers
const layoutBtns = document.querySelectorAll('.layout-btn');
if (layoutBtns.length > 0 && bookGrid) {
  let currentLayout = localStorage.getItem('stacksLayout') || 'layout-grid';
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
      
      bookGrid.className = 'book-grid ' + currentLayout;
      bookGrid.style.opacity = 0;
      setTimeout(() => { bookGrid.style.opacity = 1; }, 50);
    });
  });
}

// =========================================================================
// MODULE 4: THE WANDER DRAWER (FILTERS, SORTS & SEARCH ENGINE)
// =========================================================================

// Evaluates filters and sorts matching data, compiling lists for grid display
function applyLibraryFilters() {
  let filteredBooks = [...globalLibraryData];

  const searchInput = document.getElementById('local-search');
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

  const activeBtn = document.querySelector('.quick-btn.active, .filter-btn.active');
  const statusFilter = activeBtn ? activeBtn.getAttribute('data-status') : 'all';
  const sortMethod = activeBtn ? activeBtn.getAttribute('data-sort') : 'title_asc';

  filteredBooks = filteredBooks.filter(book => {
    const title = (getField(book, 'title') || '').toLowerCase();
    const author = (getField(book, 'author') || '').toLowerCase();
    const matchesSearch = title.includes(searchTerm) || author.includes(searchTerm);

    const status = getField(book, 'status');
    const matchesStatus = (statusFilter === 'all' || !statusFilter) ? true : Number(status) === Number(statusFilter);

    let matchesYear = true;
    if (libraryYearFilter !== 'all') {
      const bookStatus = Number(getField(book, 'status'));
      const bookReadDate = getField(book, 'read_date') || getField(book, 'date_finished');
      matchesYear = (bookStatus === 2 && bookReadDate && String(bookReadDate).startsWith(libraryYearFilter));
    }

    return matchesSearch && matchesStatus && matchesYear;
  });

  // Sort Mechanics
  filteredBooks.sort((a, b) => {
    if (sortMethod === 'title_asc') {
      return (getField(a, 'title') || 'Z').toLowerCase().localeCompare((getField(b, 'title') || 'Z').toLowerCase());
    } else if (sortMethod === 'author_asc') {
      return (getField(a, 'author') || 'Z').toLowerCase().localeCompare((getField(b, 'author') || 'Z').toLowerCase());
    } else if (sortMethod === 'rating_desc') {
      return (Number(getField(b, 'rating')) || 0) - (Number(getField(a, 'rating')) || 0);
    } else if (sortMethod === 'date_finished_desc') {
      const db = parseSafeDate(getField(b, 'read_date') || getField(b, 'date_finished'));
      const da = parseSafeDate(getField(a, 'read_date') || getField(a, 'date_finished'));
      return db - da;
    } else if (sortMethod === 'date_started_desc') {
      const db = parseSafeDate(getField(b, 'date_started'));
      const da = parseSafeDate(getField(a, 'date_started'));
      return db - da;
    } else {
      const db = parseSafeDate(getField(b, 'created_at') || getField(b, 'date_added'));
      const da = parseSafeDate(getField(a, 'created_at') || getField(a, 'date_added'));
      return db - da; 
    }
  });

  const subheading = document.getElementById('library-subheading');
  if (subheading) {
    let headingText = activeBtn ? activeBtn.textContent.trim() : 'All Books, by Title (A-Z)'; 
    if (libraryYearFilter !== 'all') headingText = `Finished in ${libraryYearFilter}`;
    if (searchTerm) headingText += ` (Searching: "${searchTerm}")`; 
    subheading.textContent = headingText;
  }

  window.lastAppliedSort = sortMethod; 
  renderGrid(filteredBooks);
  updateQuickFilterButtonsUI();
}

function updateQuickFilterButtonsUI() {
  const originalLabels = {
    '1': 'Current Reads',
    '0': 'TBR List',
    '2': 'Finished',
    '3': 'Gave Up'
  };
  document.querySelectorAll('.quick-btn').forEach(btn => {
    const status = btn.getAttribute('data-status');
    if (btn.classList.contains('active')) {
      btn.textContent = `${originalLabels[status]} ✕`;
    } else {
      btn.textContent = originalLabels[status];
    }
  });
}

// Sets up drawer open/close and filter listeners
const wanderTriggerBtn = document.getElementById('wander-trigger-btn');
const wanderSheet = document.getElementById('wander-sheet');
const localSearchInput = document.getElementById('local-search');
const quickBtns = document.querySelectorAll('.quick-btn, .filter-btn');

if (wanderTriggerBtn && wanderSheet) {
  wanderTriggerBtn.addEventListener('click', () => wanderSheet.classList.add('open'));
  
  const wanderHandle = wanderSheet.querySelector('.sheet-handle');
  if (wanderHandle) wanderHandle.addEventListener('click', () => wanderSheet.classList.remove('open'));
  
  quickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const isActive = btn.classList.contains('active');
      
      libraryYearFilter = 'all'; 
      quickBtns.forEach(b => { b.classList.remove('active'); b.style.background = ''; b.style.color = ''; });
      document.querySelectorAll('.hero-pill-btn').forEach(b => b.classList.remove('active'));
      
      if (!isActive) {
        btn.classList.add('active');
      }
      
      applyLibraryFilters(); 
      wanderSheet.classList.remove('open');
      const activeView = document.querySelector('.page-view.active');
      if (activeView) activeView.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// Syncs manual search/dropdown events and clear search button visibility
const clearSearchBtn = document.getElementById('clear-search-btn');
const submitSearchBtn = document.getElementById('submit-search-btn');

if (localSearchInput) {
  localSearchInput.addEventListener('input', () => {
    if (clearSearchBtn) {
      if (localSearchInput.value.length > 0) {
        clearSearchBtn.style.display = 'block';
      } else {
        clearSearchBtn.style.display = 'none';
      }
    }
    applyLibraryFilters();
  });

  localSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      applyLibraryFilters();
      if (wanderSheet) wanderSheet.classList.remove('open');
    }
  });
}

if (clearSearchBtn) {
  clearSearchBtn.addEventListener('click', () => {
    if (localSearchInput) localSearchInput.value = '';
    clearSearchBtn.style.display = 'none';
    applyLibraryFilters();
  });
}

if (submitSearchBtn) {
  submitSearchBtn.addEventListener('click', () => {
    applyLibraryFilters();
    if (wanderSheet) wanderSheet.classList.remove('open');
  });
}

// Swipe to close gestures implementation for drawers
let touchStartY = 0;
let touchCurrentY = 0;
let isSwiping = false;

if (wanderSheet) { 
  wanderSheet.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
    isSwiping = true;
    wanderSheet.style.transition = 'none'; 
  }, { passive: true });

  wanderSheet.addEventListener('touchmove', (e) => {
    if (!isSwiping) return;
    touchCurrentY = e.touches[0].clientY;
    const deltaY = touchCurrentY - touchStartY;
    if (deltaY > 0) { 
      wanderSheet.style.transform = `translateY(${deltaY}px)`;
    }
  }, { passive: true });

  wanderSheet.addEventListener('touchend', () => {
    if (!isSwiping) return;
    isSwiping = false;
    const deltaY = touchCurrentY - touchStartY;
    
    wanderSheet.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    wanderSheet.style.transform = ''; 

    if (deltaY > 80) {
      wanderSheet.classList.remove('open');
    }
  });
}

// Navigates from Hero directly to predefined filters
function navigateToQuickFilter(status, sort, sourceBtn = null) {
  document.querySelector('.nav-item[data-target="view-library"]').click();
  libraryYearFilter = 'all';
  document.querySelectorAll('.quick-btn, .filter-btn').forEach(b => b.classList.remove('active'));
  
  const targetBtn = document.querySelector(`.quick-btn[data-status="${status}"]`);
  if (targetBtn) targetBtn.classList.add('active');

  document.querySelectorAll('.hero-pill-btn').forEach(b => b.classList.remove('active'));
  if (sourceBtn) sourceBtn.classList.add('active');

  window.lastAppliedSort = sort; 
  applyLibraryFilters();
}

// =========================================================================
// MODULE 5: BOOK DETAILS SCREEN (READING JOURNAL)
// =========================================================================

const viewDetails = document.getElementById('view-details');
const closeDetailsBtn = document.getElementById('close-details-btn');
const journalContent = document.getElementById('journal-content');

// Helper to batch database and local memory updates in a single connection
async function updateMultipleBookFields(updatesObj) {
  if (!currentOpenBookId || Object.keys(updatesObj).length === 0) return;

  const { data, error } = await supabase
    .from('books')
    .update(updatesObj)
    .eq('uuid', currentOpenBookId);

  if (error) {
    console.error('Error updating book:', error);
  } else {
    const bookToUpdate = globalLibraryData.find(b => b.uuid === currentOpenBookId);
    if (bookToUpdate) {
      for (const [key, value] of Object.entries(updatesObj)) {
        const matchedKey = Object.keys(bookToUpdate).find(k => k.toLowerCase() === key.toLowerCase()) || key;
        bookToUpdate[matchedKey] = value;
      }
    }
  }
}

// Overloaded helper for backward compatibility with single field updates
async function updateBookData(columnName, newValue) {
  await updateMultipleBookFields({ [columnName]: newValue });
}

// Open Journal details container for selected entry
function openDetails(book, clickedElement) {
  const possibleViews = ['view-library', 'view-search', 'view-stats'];
  possibleViews.forEach(viewId => {
    const viewEl = document.getElementById(viewId);
    if (viewEl && viewEl.classList.contains('active')) {
      returnViewId = viewId;
      scrollCache[viewId] = viewEl.scrollTop;
    }
  });

  window.history.pushState({ level: 'overlay' }, '');
  currentOpenBookId = book.uuid; 
  
  const title = getField(book, 'title') || 'Unknown Title';
  const author = getField(book, 'author') || 'Unknown Author';
  const coverUrl = getField(book, 'cover_url') || 'https://placehold.co/60x90?text=No+Cover';
  const ratingNum = Number(getField(book, 'rating')) || 0;
  const statusNum = String(getField(book, 'status') || '0');
  const notes = getField(book, 'notes') || '';
  
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

  const formatVintageDate = (iso) => {
    if (!iso) return 'mm-dd-yy';
    const d = new Date(iso);
    if (isNaN(d)) return 'mm-dd-yy';
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getFullYear()).slice(-2)}`;
  };

  // Stamp renders
  let stampsHtml = '';
  if (statusNum === '1') { 
    stampsHtml = `<div class="stamp-container"><span class="stamp stamp-started">STARTED<br/>${formatVintageDate(rawStarted)}</span></div>`;
  } else if (statusNum === '2') { 
    stampsHtml = `<div class="stamp-container"><span class="stamp stamp-finished">FINISHED<br/>${formatVintageDate(rawFinished)}</span></div>`;
  }

  // Interactive Stars
  let starsHtml = `<div id="details-stars" style="display: flex; gap: 4px; font-size: 24px; margin-bottom: 5px;">`;
  for (let i = 1; i <= 5; i++) {
    starsHtml += `<span data-value="${i}" style="color: ${i <= ratingNum ? '#DDA750' : '#e0dcd3'}; cursor:pointer; transition: transform 0.1s;">★</span>`;
  }
  starsHtml += `</div>`;

  // Missing Cover resolution UX logic
  const hasPlaceholderCover = !coverUrl || coverUrl.includes('placehold.co');
  let coverHtml = '';
  if (hasPlaceholderCover) {
    coverHtml = `
      <div id="details-cover-container" class="special-card" style="position: relative; width: 110px; height: 165px; border-radius: 6px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); background: var(--card-bg); flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: background-color 0.2s;" title="Resolve cover from Google Books">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--sage-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 5px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <span style="font-family: 'Courier New'; font-size: 0.75rem; color: var(--sage-green); font-weight: bold; text-align: center; padding: 0 5px;">Find Cover</span>
        <span style="font-size: 0.65rem; color: var(--text-dark); margin-top: 2px;">Tap to search</span>
      </div>
    `;
  } else {
    coverHtml = `
      <img src="${coverUrl}" style="width: 110px; border-radius: 6px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); flex-shrink: 0;" onerror="this.src='https://placehold.co/60x90?text=No+Cover'">
    `;
  }

  // Action buttons bar redesign (using text + inline SVGs)
  const actionBarHtml = `
    <div class="details-action-bar" style="display: flex; gap: 10px; width: 100%; margin-top: 15px; margin-bottom: 15px; flex-wrap: wrap;">
      <button id="btn-read-again" class="details-pill-btn" style="flex: 1; min-width: 105px; display: flex; align-items: center; justify-content: center; gap: 6px; background-color: var(--sage-green); color: var(--bg-color); border: none; padding: 10px 12px; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 0.8rem; font-weight: bold; cursor: pointer; transition: transform 0.1s;" title="Start a new reading journey">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
        Read Again
      </button>
      <button id="btn-refresh-book" class="details-pill-btn" style="flex: 1; min-width: 105px; display: flex; align-items: center; justify-content: center; gap: 6px; background-color: transparent; color: var(--text-dark); border: 1px solid var(--detail-line); padding: 10px 12px; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 0.8rem; font-weight: bold; cursor: pointer; transition: transform 0.1s;" title="Sync details with Google Books">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        Find Cover
      </button>
      <button id="btn-delete-book" class="details-pill-btn" style="flex: 1; min-width: 105px; display: flex; align-items: center; justify-content: center; gap: 6px; background-color: transparent; color: var(--terracotta); border: 1px solid var(--terracotta); padding: 10px 12px; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 0.8rem; font-weight: bold; cursor: pointer; transition: transform 0.1s;" title="Delete this book">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        Delete
      </button>
    </div>
  `;

  const pencilSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;

  journalContent.innerHTML = `
    <div style="display: flex; gap: 20px; align-items: flex-start; width: 100%; text-align: left; margin-bottom: 10px;">
      ${coverHtml}
      <div style="flex-grow: 1; min-width: 0;">
        <h2 style="font-family: 'Georgia', serif; font-size: 1.25rem; font-weight: bold; color: var(--text-dark); margin: 0 0 4px 0; line-height: 1.2; overflow-wrap: break-word;">${title}</h2>
        <p style="font-family: 'Courier New'; font-size: 0.9rem; color: var(--sage-green); margin: 0 0 10px 0;">by ${author}</p>
        ${starsHtml}
        ${stampsHtml}
      </div>
    </div>

    <div style="display: flex; flex-direction: column; width: 100%; margin-bottom: 15px;">
      <div class="journal-meta-card" style="width: 100%;">
        <div class="meta-row">
          <span class="meta-label">Status:</span> 
          <div class="input-with-icon">
            <select id="inline-status" class="inline-edit-input">
              <option value="0" ${statusNum === '0' ? 'selected' : ''}>TBR</option>
              <option value="1" ${statusNum === '1' ? 'selected' : ''}>Reading</option>
              <option value="2" ${statusNum === '2' ? 'selected' : ''}>Finished</option>
              <option value="3" ${statusNum === '3' ? 'selected' : ''}>Gave Up</option>
            </select>
            <span class="pencil-trigger" data-target="inline-status">${pencilSvg}</span>
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
            <span class="pencil-trigger" data-target="inline-started">${pencilSvg}</span>
          </div>
        </div>
        <div class="meta-row">
          <span class="meta-label">Finished:</span> 
          <div class="input-with-icon">
            <input type="date" id="inline-finished" class="inline-edit-input" value="${finishedVal}">
            <span class="pencil-trigger" data-target="inline-finished">${pencilSvg}</span>
          </div>
        </div>
      </div>
      
      ${actionBarHtml}
    </div>

    <div style="width: 100%; text-align: left;">
      <h3 style="font-family: 'Courier New'; color: var(--terracotta); margin: 0 0 10px 0; font-size: 1rem;">Notes</h3>
      <div style="position: relative;">
        <textarea id="journal-notes-area" class="journal-notes-input" placeholder="Tap to add your thoughts...">${notes}</textarea>
        <button id="btn-save-notes" style="position: absolute; bottom: 12px; right: 12px; background: var(--terracotta); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-family: 'Courier New'; font-weight: bold; cursor: pointer; display: none;">Save</button>
      </div>
    </div>
  `;

  // Control details header shadows on scroll
  const detailsContainer = document.getElementById('view-details');
  const detailsHeader = document.querySelector('.details-header');
  if (detailsContainer && detailsHeader) {
    detailsContainer.addEventListener('scroll', () => {
      if (detailsContainer.scrollTop > 50) {
        detailsHeader.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        detailsHeader.style.borderBottom = '1px solid rgba(0,0,0,0.1)';
      } else {
        detailsHeader.style.boxShadow = 'none';
        detailsHeader.style.borderBottom = 'none';
      }
    });
  }
  
  pageViews.forEach(view => view.classList.remove('active'));
  if (detailsContainer) {
    detailsContainer.classList.add('active');
    detailsContainer.scrollTop = 0; 
    updateFabVisibility();
  }

  // Close detail view routing
  function closeBookDetails() {
    const detailsContainer = document.getElementById('view-details'); 
    if (detailsContainer) detailsContainer.classList.remove('active'); 
    
    pageViews.forEach(view => view.classList.remove('active'));
    const previousView = document.getElementById(lastActiveTab);
    if (previousView) {
      previousView.classList.add('active');
      requestAnimationFrame(() => {
        previousView.scrollTop = scrollCache[lastActiveTab] || 0;
        updateFabVisibility();
      });
    } else {
      document.getElementById('view-library').classList.add('active');
    }
    currentOpenBookId = null; 
  }

  // Attach Details Event Listeners
  
  // Date Picker Pencil triggers
  document.querySelectorAll('.pencil-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetId = trigger.getAttribute('data-target');
      const targetInput = document.getElementById(targetId);
      if (targetInput) {
        try {
          targetInput.showPicker();
        } catch (err) {
          console.error('showPicker failed, falling back to focus/click:', err);
          targetInput.focus();
          targetInput.click();
        }
      }
    });
  });

  // Inline Status Change dropdown listener
  document.getElementById('inline-status').addEventListener('change', async (e) => {
    const newStatus = parseInt(e.target.value);
    const updatedBook = globalLibraryData.find(b => b.uuid === currentOpenBookId);
    const todayIso = new Date().toISOString();
    
    const updates = { status: newStatus };
    
    if (newStatus === 1) { 
      updates.date_started = todayIso;
      updates.read_date = null;
    } else if (newStatus === 2) { 
      updates.read_date = todayIso;
    }
    
    await updateMultipleBookFields(updates);
    
    renderHeroSection();
    calculateStats();
    openDetails(updatedBook); 
    applyLibraryFilters(); 
  });

  // Date Started selection listener
  document.getElementById('inline-started').addEventListener('change', async (e) => {
    const updatedBook = globalLibraryData.find(b => b.uuid === currentOpenBookId);
    const rawInput = e.target.value;
    
    if (!rawInput) {
      await updateBookData('date_started', null);
    } else {
      const [year, month, day] = rawInput.split('-');
      const isoString = new Date(year, month - 1, day).toISOString();
      
      // Validation: Start Date cannot be in the future
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (new Date(year, month - 1, day) > today) {
        alert("Start date cannot be in the future.");
        const currentStarted = getField(updatedBook, 'date_started');
        e.target.value = currentStarted ? currentStarted.split('T')[0] : '';
        return;
      }

      await updateBookData('date_started', isoString);
    }
    openDetails(updatedBook);
  });

  // Date Finished selection listener
  document.getElementById('inline-finished').addEventListener('change', async (e) => {
    const updatedBook = globalLibraryData.find(b => b.uuid === currentOpenBookId);
    const rawInput = e.target.value;

    if (!rawInput) {
      await updateBookData('read_date', null);
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

      if (newDateObj > today) {
        alert("Finished date cannot be in the future.");
        const currentFinished = getField(updatedBook, 'read_date') || getField(updatedBook, 'date_finished');
        e.target.value = currentFinished ? currentFinished.split('T')[0] : '';
        return;
      }
      
      if (startedDateObj && newDateObj < startedDateObj) {
        alert("Finished date cannot be before the Started date.");
        const currentFinished = getField(updatedBook, 'read_date') || getField(updatedBook, 'date_finished');
        e.target.value = currentFinished ? currentFinished.split('T')[0] : '';
        return;
      }

      const isoString = newDateObj.toISOString();
      await updateMultipleBookFields({
        read_date: isoString,
        status: 2
      });
    }

    renderHeroSection();
    calculateStats();
    openDetails(updatedBook);
    applyLibraryFilters();
  });

  // Star Ratings Editor
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

  // Notes Autosave bindings
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

  // Sync details from Google Books (Refactored to optimize DB calls)
  const triggerGoogleBooksSync = async () => {
    const coverContainer = document.getElementById('details-cover-container');
    const syncBtn = document.getElementById('btn-refresh-book');
    
    if (coverContainer) {
      coverContainer.style.background = 'rgba(139, 94, 52, 0.1)';
      coverContainer.innerHTML = `<span style="font-family: 'Courier New'; font-size: 0.75rem; color: var(--sage-green); font-weight: bold;">Syncing...</span>`;
    }
    if (syncBtn) {
      syncBtn.style.opacity = '0.5';
      syncBtn.style.pointerEvents = 'none';
      syncBtn.innerHTML = 'Syncing...';
    }

    const isbn = getField(book, 'isbn');
    const qTitle = getField(book, 'title') || '';
    const qAuthor = getField(book, 'author') || '';
    let query = '';
    
    const cleanIsbn = String(isbn).replace(/[-\s]/g, '');
    const isValidIsbn = /^\d{10}(\d{3})?$/.test(cleanIsbn);
    
    if (isValidIsbn) {
      query = `isbn:${cleanIsbn}`;
    } else {
      let parts = [];
      if (qTitle.trim()) parts.push(`intitle:${qTitle.trim()}`);
      if (qAuthor.trim()) parts.push(`inauthor:${qAuthor.trim()}`);
      query = parts.join(' ');
    }

    if (!query) {
      resetSyncUI();
      return;
    }

    try {
      const data = await fetchBooksFromAPIs(query);

      if (data.items && data.items.length > 0) {
        const volumeInfo = data.items[0].volumeInfo;
        const updates = {};
        if (volumeInfo.imageLinks?.thumbnail) updates.cover_url = volumeInfo.imageLinks.thumbnail.replace('http:', 'https:');
        if (volumeInfo.pageCount) updates.pages = volumeInfo.pageCount;
        if (volumeInfo.categories?.length > 0) updates.category = volumeInfo.categories[0];
        
        await updateMultipleBookFields(updates);
        
        const updatedBook = globalLibraryData.find(b => b.uuid === currentOpenBookId);
        openDetails(updatedBook);
        applyLibraryFilters();
      } else {
        await showStacksModal('Not Found', 'Could not find matching book details.');
        resetSyncUI();
      }
    } catch (error) {
      console.error(error);
      resetSyncUI();
    }
  };

  const resetSyncUI = () => {
    const coverContainer = document.getElementById('details-cover-container');
    const syncBtn = document.getElementById('btn-refresh-book');
    if (coverContainer) {
      coverContainer.style.background = 'var(--card-bg)';
      coverContainer.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--sage-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 5px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <span style="font-family: 'Courier New'; font-size: 0.75rem; color: var(--sage-green); font-weight: bold; text-align: center; padding: 0 5px;">Find Cover</span>
        <span style="font-size: 0.65rem; color: var(--text-dark); margin-top: 2px;">Tap to search</span>
      `;
    }
    if (syncBtn) {
      syncBtn.style.opacity = '1';
      syncBtn.style.pointerEvents = 'auto';
      syncBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        Find Cover
      `;
    }
  };

  // Bind Cover Resolver click event
  const detailsCoverContainer = document.getElementById('details-cover-container');
  if (detailsCoverContainer) {
    detailsCoverContainer.addEventListener('click', triggerGoogleBooksSync);
  }

  // Bind Sync Info action button click event
  document.getElementById('btn-refresh-book').addEventListener('click', triggerGoogleBooksSync);

  // Read Again duplicate duplicator
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
        renderHeroSection();
        calculateStats();
        applyLibraryFilters(); 
        await showStacksModal("Success", "New journey added! Check your Current Reads.", false);
        closeBookDetails();
      }
    }
  });

  // Delete/Return book action click event
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

  if (closeDetailsBtn) closeDetailsBtn.onclick = closeBookDetails;
}

// =========================================================================
// MODULE 6: GOOGLE BOOKS API SEARCH & CAMERA SCANNER
// =========================================================================

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
          if (searchBtn) searchBtn.click();
        });
      },
      (err) => { /* Ignore constant scan frame read errors */ }
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

// Search Google Books DB by title, author, or ISBN
async function searchGoogleBooks(query) {
  if (!query) return;

  if (searchResultsContainer) searchResultsContainer.innerHTML = '<p style="text-align:center; color: var(--sage-green); font-family: Courier New;">Searching the archives...</p>';

  try {
    const data = await fetchBooksFromAPIs(query);

    if (searchResultsContainer) searchResultsContainer.innerHTML = '';
    document.getElementById('search-results-header').classList.remove('hidden');

    if (!data.items || data.items.length === 0) {
      if (searchResultsContainer) searchResultsContainer.innerHTML = '<p style="text-align:center; color: var(--sage-green); font-family: Courier New;">No books found. Try a different search.</p>';
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

      if (searchResultsContainer) searchResultsContainer.appendChild(card);
    });

    // Setup Add Book listeners inside search results
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
        payload[getKey('status')] = 0; 
        payload[getKey('isbn')] = decodeURIComponent(button.dataset.isbn);
        payload[getKey('category')] = decodeURIComponent(button.dataset.category);
        payload[getKey('cover_url')] = decodeURIComponent(button.dataset.cover);

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
            setTimeout(() => { openDetails(savedBook); }, 600);
            loadBooks(); 
          }
        }
      });
    });
  } catch (error) {
    console.error("Search failed:", error);
    if (searchResultsContainer) searchResultsContainer.innerHTML = '<p style="text-align:center; color: #a34e4e;">Something went wrong. Please try again.</p>';
  }
}

if (searchBtn) searchBtn.addEventListener('click', () => searchGoogleBooks(searchInput.value));
if (searchInput) {
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchGoogleBooks(searchInput.value);
  });
}

// =========================================================================
// MODULE 7: INTERACTIVE FOCUS SESSION
// =========================================================================

const timerDisplay = document.getElementById('timer-display');
const playPauseBtn = document.getElementById('play-pause-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const focusDurationSelect = document.getElementById('focus-duration');
const focusCloseBtn = document.getElementById('focus-close-btn');
const sound = new Audio('uplifting-bells.wav');

let focusInterval;
let timeRemaining = 1200; 
let isTimerRunning = false;
let audioCtx; 

function updateTimerDisplay() {
  const mins = Math.floor(timeRemaining / 60);
  const secs = timeRemaining % 60;
  if (timerDisplay) timerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

if (playPauseBtn) {
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
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (timerDisplay) timerDisplay.style.color = "var(--text-dark)";
    
    timeRemaining = parseInt(focusDurationSelect.value);
    updateTimerDisplay();
  });
}

// Safely play chimes without unhandled promise warnings
function playCozyChime() {
  sound.play().catch(err => {
    console.warn("Audio playback blocked by autoplay settings:", err);
  });
}

if (focusCloseBtn) {
  focusCloseBtn.addEventListener('click', () => {
    const prevNavBtn = document.querySelector(`.nav-item[data-target="${previousViewId}"]`);
    if (prevNavBtn) prevNavBtn.click();
  });
}

// =========================================================================
// MODULE 8: SYSTEM DIALOGS & UTILITY INTERFACES
// =========================================================================

// Custom confirm dialog replacement
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
      cancelBtn.style.display = 'none';
      confirmBtn.textContent = 'OK'; // Restyled confirmation feedback
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

// Header branding scroll to top trigger
const headerScrollTrigger = document.getElementById('header-scroll-trigger');
if (headerScrollTrigger) {
  headerScrollTrigger.addEventListener('click', () => {
    const activeView = document.querySelector('.page-view.active');
    if (activeView) activeView.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// Feedback Modal controls
const feedbackModal = document.querySelector('.feedback-modal');
const feedbackTriggerBtn = document.getElementById('feedback-trigger-btn');
const closeXBtn = document.querySelector('.close-modal');
const closeFeedbackBtn = document.getElementById('close-feedback-btn');
const submitFeedbackBtn = document.getElementById('submit-feedback-btn');
const feedbackText = document.getElementById('feedback-text');

if (feedbackModal && feedbackTriggerBtn) {
  feedbackTriggerBtn.addEventListener('click', () => {
    feedbackModal.classList.remove('hidden');
  });

  const closeModal = () => {
    feedbackModal.classList.add('hidden');
    if (feedbackText) feedbackText.value = ''; 
  };

  if (closeXBtn) closeXBtn.addEventListener('click', closeModal);
  if (closeFeedbackBtn) closeFeedbackBtn.addEventListener('click', closeModal);

  feedbackModal.addEventListener('click', (e) => {
    if (e.target === feedbackModal) closeModal();
  });

  if (submitFeedbackBtn) {
    submitFeedbackBtn.addEventListener('click', async () => {
      const text = feedbackText.value.trim();
      if (!text) return;

      const originalText = submitFeedbackBtn.textContent;
      submitFeedbackBtn.textContent = 'Sending...';
      submitFeedbackBtn.disabled = true;

      const { error } = await supabase
        .from('feedback')
        .insert([{ message: text }]);

      if (error) {
        console.error('Error sending feedback:', error);
        submitFeedbackBtn.textContent = 'Error!';
        submitFeedbackBtn.style.backgroundColor = '#a34e4e'; 
      } else {
        submitFeedbackBtn.textContent = 'Sent!';
        submitFeedbackBtn.style.backgroundColor = 'var(--sage-green)';
        
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

// Tab navigation routing and scrollCache retention
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetId = item.getAttribute('data-target');

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
    
    if (targetView) {
      targetView.classList.add('active');
      requestAnimationFrame(() => {
        const savedScroll = scrollCache[targetId] || 0;
        targetView.scrollTop = savedScroll;
        updateFabVisibility();
      });
    }

    if (sheet && sheet.classList.contains('open')) sheet.classList.remove('open');
  });
});

if (topFab) {
  pageViews.forEach(view => {
    view.addEventListener('scroll', () => {
      updateFabVisibility();
    });
  });

  topFab.addEventListener('click', () => {
    const activeView = document.querySelector('.page-view.active');
    if (activeView) activeView.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// History API popstate event routing
window.history.replaceState({ level: 'trap' }, '');
window.history.pushState({ level: 'main' }, '');

window.addEventListener('popstate', (event) => {
  setTimeout(() => {
    window.history.pushState({ level: 'main' }, '');
  }, 300);

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

  if (feedbackModal && !feedbackModal.classList.contains('hidden')) {
    feedbackModal.classList.add('hidden');
    return;
  }

  if (wanderSheet && wanderSheet.classList.contains('open')) {
    wanderSheet.classList.remove('open');
    return;
  }

  if (viewDetails && viewDetails.classList.contains('active')) {
    const closeDetailsBtn = document.getElementById('close-details-btn');
    if (closeDetailsBtn) closeDetailsBtn.click(); 
    return;
  }

  const libraryView = document.getElementById('view-library');
  if (libraryView && !libraryView.classList.contains('active')) {
    const libraryNav = document.querySelector('.nav-item[data-target="view-library"]');
    if (libraryNav) libraryNav.click();
  }
});

// Phase 4 Stats Render & Drilling Engine
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
    const coverUrl = getField(book, 'cover_url') || 'https://placehold.co/150x200?text=No+Cover';
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
  const finishedBooks = globalLibraryData.filter(b => Number(getField(b, 'status')) === 2 && (getField(b, 'read_date') || getField(b, 'date_finished')));
  const container = document.getElementById('stats-chart-container');
  
  if (targetYear === 'all') {
    const yearsMap = {};
    finishedBooks.forEach(b => {
      const readDate = getField(b, 'read_date') || getField(b, 'date_finished');
      const y = String(readDate).split('-')[0]; 
      yearsMap[y] = (yearsMap[y] || 0) + 1;
    });
    
    const labels = Object.keys(yearsMap).sort();
    const data = labels.map(y => yearsMap[y]);
    
    container.style.height = '280px';
    drawChart('bar', labels, data, '#A65239', 10, (clickedIndex) => {
      const selectedYear = labels[clickedIndex];
      document.getElementById('stats-year-select').value = selectedYear;
      renderAnnualStats(selectedYear);
    });
    
    renderStatsList(finishedBooks.sort((a, b) => {
      const db = parseSafeDate(getField(b, 'read_date') || getField(b, 'date_finished'));
      const da = parseSafeDate(getField(a, 'read_date') || getField(a, 'date_finished'));
      return db - da;
    }), `All Time Books (${finishedBooks.length})`);
    document.getElementById('stats-drilldown-nav').classList.add('hidden');
    document.getElementById('btn-view-in-stacks').style.display = 'flex';
  } else {
    const filtered = finishedBooks.filter(b => {
      const readDate = getField(b, 'read_date') || getField(b, 'date_finished');
      return readDate && String(readDate).startsWith(targetYear);
    });
    const monthlyCounts = Array(12).fill(0);
    
    filtered.forEach(b => {
      const readDate = getField(b, 'read_date') || getField(b, 'date_finished');
      const m = parseInt(String(readDate).split('-')[1]) - 1; 
      monthlyCounts[m]++;
    });

    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const maxValue = Math.max(5, ...monthlyCounts); 
    container.style.height = `${Math.max(250, (maxValue * 25) + 50)}px`; 

    let barColors = Array(12).fill('#597755'); 

    drawChart('bar', monthLabels, monthlyCounts, barColors, 1, (clickedIndex) => {
      barColors = Array(12).fill('#597755');
      barColors[clickedIndex] = '#A65239';
      statsChartInstance.data.datasets[0].backgroundColor = barColors;
      statsChartInstance.update();
      renderMonthlyStatsList(clickedIndex, targetYear); 
    });

    renderStatsList(filtered.sort((a, b) => {
      const db = parseSafeDate(getField(b, 'read_date') || getField(b, 'date_finished'));
      const da = parseSafeDate(getField(a, 'read_date') || getField(a, 'date_finished'));
      return db - da;
    }), `Books Finished in ${targetYear} (${filtered.length})`);
    document.getElementById('stats-drilldown-nav').classList.add('hidden');
    document.getElementById('btn-view-in-stacks').style.display = 'flex';
  }
}

function renderMonthlyStatsList(monthIndex, yearStr) {
  currentStatsMonth = monthIndex;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  const targetPrefix = `${yearStr}-${String(monthIndex + 1).padStart(2, '0')}`;
  const monthlyBooks = globalLibraryData.filter(b => {
    const status = Number(getField(b, 'status'));
    const readDate = getField(b, 'read_date') || getField(b, 'date_finished');
    return status === 2 && readDate && String(readDate).startsWith(targetPrefix);
  });

  renderStatsList(monthlyBooks.sort((a, b) => {
    const db = parseSafeDate(getField(b, 'read_date') || getField(b, 'date_finished'));
    const da = parseSafeDate(getField(a, 'read_date') || getField(a, 'date_finished'));
    return db - da;
  }), `${fullMonthNames[monthIndex]} ${yearStr} Reads (${monthlyBooks.length})`);
  document.getElementById('btn-view-in-stacks').style.display = 'none'; 

  const navDiv = document.getElementById('stats-drilldown-nav');
  const backBtn = document.getElementById('btn-stats-back');
  backBtn.innerHTML = `<span style="font-size:12px;">✕</span> Clear ${monthNames[monthIndex]}`;
  
  backBtn.onclick = () => {
    statsChartInstance.data.datasets[0].backgroundColor = Array(12).fill('#597755');
    statsChartInstance.update();
    
    const filtered = globalLibraryData.filter(b => {
      const status = Number(getField(b, 'status'));
      const readDate = getField(b, 'read_date') || getField(b, 'date_finished');
      return status === 2 && readDate && String(readDate).startsWith(yearStr);
    });
    renderStatsList(filtered.sort((a, b) => {
      const db = parseSafeDate(getField(b, 'read_date') || getField(b, 'date_finished'));
      const da = parseSafeDate(getField(a, 'read_date') || getField(a, 'date_finished'));
      return db - da;
    }), `Books Finished in ${yearStr} (${filtered.length})`);
    document.getElementById('btn-view-in-stacks').style.display = 'flex';
    navDiv.classList.add('hidden');
    currentStatsMonth = null;
  };
  
  navDiv.classList.remove('hidden');
}

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
  const finishedBooks = globalLibraryData.filter(b => {
    const status = Number(getField(b, 'status'));
    const readDate = getField(b, 'read_date') || getField(b, 'date_finished');
    return status === 2 && readDate;
  });
  const years = [...new Set(finishedBooks.map(b => {
    const readDate = getField(b, 'read_date') || getField(b, 'date_finished');
    return String(readDate).split('-')[0];
  }))].sort((a, b) => b - a);
  
  yearSelect.innerHTML = '<option value="all">All Time</option>';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    yearSelect.appendChild(opt);
  });

  yearSelect.addEventListener('change', (e) => renderAnnualStats(e.target.value));

  document.getElementById('btn-view-in-stacks').addEventListener('click', () => {
    document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-library').classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-target="view-library"]').classList.add('active');
    lastActiveTab = 'view-library';

    libraryYearFilter = currentStatsYear; 

    document.querySelectorAll('.quick-btn, .filter-btn').forEach(btn => btn.classList.remove('active'));
    const finishedBtn = document.querySelector('[data-sort="date_finished_desc"]'); 
    if (finishedBtn) finishedBtn.classList.add('active');

    applyLibraryFilters(); 
    document.querySelectorAll('.hero-pill-btn').forEach(b => b.classList.remove('active'));
  });
}

function calculateStats() {
  const books = globalLibraryData;
  const timeFilterEl = document.getElementById('stats-timefilter');
  const filter = timeFilterEl ? timeFilterEl.value : 'year';
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const activeCount = books.filter(b => Number(getField(b, 'status')) === 1).length;
  
  let periodCount = 0;
  const completedBooks = books.filter(b => Number(getField(b, 'status')) === 2 && (getField(b, 'read_date') || getField(b, 'date_finished')));
  
  completedBooks.forEach(b => {
    const readDateStr = getField(b, 'read_date') || getField(b, 'date_finished');
    const timestamp = parseSafeDate(readDateStr);
    if (timestamp === 0) return;
    const readDate = new Date(timestamp);
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

// Reusable utilities
const getField = (obj, fieldName) => {
  if (!obj) return undefined;
  const key = Object.keys(obj).find(k => k.toLowerCase() === fieldName.toLowerCase());
  return key ? obj[key] : undefined;
};

function parseSafeDate(val) {
  if (!val) return 0;
  const parsed = Date.parse(val);
  return isNaN(parsed) ? 0 : parsed;
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  return `${m}-${d}-${y}`;
}

function getCoverUrl(isbn) {
  if (!isbn || isbn === 'N/A') return 'https://placehold.co/150x200?text=No+Cover';
  const cleanIsbn = String(isbn).replace(/[-\s]/g, '');
  return `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-M.jpg?default=false`;
}

async function fetchBooksFromAPIs(query) {
  let data;
  let finalQuery = query.trim();
  const numbersOnly = finalQuery.replace(/[-\s]/g, '');

  if (finalQuery.toLowerCase().startsWith('isbn:')) {
    // Keep as is
  } else if (/^\d{10}(\d{3})?$/.test(numbersOnly)) {
    finalQuery = `isbn:${numbersOnly}`;
  }

  try {
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(finalQuery)}&maxResults=10`);
    if (!response.ok) throw new Error(`Google Books returned status ${response.status}`);
    data = await response.json();
    if (!data.items || data.items.length === 0) {
      throw new Error('Google Books returned empty items');
    }
  } catch (e) {
    console.warn("Google Books API failed, trying Open Library:", e);
    try {
      const response = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(finalQuery)}&limit=10`);
      if (!response.ok) throw new Error("Open Library API failed");
      const olData = await response.json();
      if (olData.docs && olData.docs.length > 0) {
        data = {
          items: olData.docs.map(doc => {
            const author = doc.author_name ? doc.author_name.join(', ') : 'Unknown Author';
            const isbn = doc.isbn ? doc.isbn[0] : '';
            let thumbnail = 'https://placehold.co/60x90?text=No+Cover';
            if (doc.cover_i) {
              thumbnail = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
            } else if (isbn) {
              thumbnail = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
            }
            return {
              volumeInfo: {
                title: doc.title,
                authors: doc.author_name || [],
                categories: doc.subject || [],
                pageCount: doc.number_of_pages_median || doc.number_of_pages || 0,
                imageLinks: { thumbnail },
                infoLink: `https://openlibrary.org${doc.key}`,
                industryIdentifiers: doc.isbn ? [{ type: 'ISBN_13', identifier: doc.isbn[0] }] : []
              }
            };
          })
        };
      } else {
        data = { items: [] };
      }
    } catch (olErr) {
      console.error("All book APIs failed:", olErr);
      data = { items: [] };
    }
  }
  return data;
}
