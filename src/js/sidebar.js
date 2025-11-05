const sidebarEl = document.querySelector('.sidebar');
const sidebarToggleBtn = document.getElementById('sidebarToggle');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const desktopCollapseBtn = document.getElementById('desktopCollapse');
const mobileMediaQuery = window.matchMedia('(max-width: 768px)');

function isMobileView() {
  return mobileMediaQuery.matches;
}

function updateSidebarToggleState() {
  if (!sidebarToggleBtn) return;
  const label = sidebarToggleBtn.querySelector('.sidebar-toggle-label');
  const mobile = isMobileView();
  const isOpenMobile = sidebarEl && sidebarEl.classList.contains('open');
  const isHiddenDesktop = document.body.classList.contains('sidebar-hidden');
  sidebarToggleBtn.setAttribute('aria-expanded', mobile ? (isOpenMobile ? 'true' : 'false') : (isHiddenDesktop ? 'false' : 'true'));
  const ariaLabel = mobile ? '切换会话列表' : (isHiddenDesktop ? '展开会话列表' : '收起会话列表');
  sidebarToggleBtn.setAttribute('aria-label', ariaLabel);
  if (label) {
    if (mobile) {
      label.textContent = '会话';
    } else {
      label.textContent = isHiddenDesktop ? '展开会话' : '收起会话';
    }
  }
  if (desktopCollapseBtn) {
    desktopCollapseBtn.setAttribute('aria-label', isHiddenDesktop ? '展开会话列表' : '收起会话列表');
    desktopCollapseBtn.classList.toggle('collapsed', isHiddenDesktop);
  }
}

function openSidebar() {
  if (!sidebarEl) return;
  if (isMobileView()) {
    sidebarEl.classList.add('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
    document.body.classList.add('sidebar-open');
  } else {
    document.body.classList.remove('sidebar-hidden');
  }
  updateSidebarToggleState();
}

function closeSidebar() {
  if (!sidebarEl) return;
  if (isMobileView()) {
    sidebarEl.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  } else {
    document.body.classList.add('sidebar-hidden');
  }
  updateSidebarToggleState();
}

function toggleSidebar() {
  if (!sidebarEl) return;
  if (isMobileView()) {
    if (sidebarEl.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  } else if (document.body.classList.contains('sidebar-hidden')) {
    openSidebar();
  } else {
    closeSidebar();
  }
}

function closeSidebarOnMobile() {
  if (isMobileView()) {
    closeSidebar();
  }
}

function syncSidebarWithViewport() {
  if (!sidebarEl) return;
  if (isMobileView()) {
    sidebarEl.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
    document.body.classList.remove('sidebar-open');
    document.body.classList.add('sidebar-hidden');
  } else {
    sidebarEl.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
    document.body.classList.remove('sidebar-open');
    document.body.classList.remove('sidebar-hidden');
  }
  updateSidebarToggleState();
}

function setupSidebarControls() {
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      toggleSidebar();
    });
  }
  if (desktopCollapseBtn) {
    desktopCollapseBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (isMobileView()) {
        toggleSidebar();
      } else if (document.body.classList.contains('sidebar-hidden')) {
        openSidebar();
      } else {
        closeSidebar();
      }
    });
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeSidebar);
  }

  const handleViewportChange = () => {
    syncSidebarWithViewport();
  };

  if (typeof mobileMediaQuery.addEventListener === 'function') {
    mobileMediaQuery.addEventListener('change', handleViewportChange);
  } else if (typeof mobileMediaQuery.addListener === 'function') {
    mobileMediaQuery.addListener(handleViewportChange);
  }

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      closeSidebar();
    }
  });

  syncSidebarWithViewport();
}

export { setupSidebarControls, closeSidebarOnMobile };
