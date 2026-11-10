// Full-screen mobile menu. The open button reports its state, focus moves into the menu and back,
// and Escape closes it.
var mobileMenu = {
  bind: function() {
    var $open = $("[data-behavior='open-mobile-menu']");
    var $menu = $(".mobile-main-menu");

    $open.on("click", function(e) {
      e.preventDefault();
      $menu.addClass("open");
      $("body").addClass("no-scroll");
      $open.attr("aria-expanded", "true");
      $menu.find("[data-behavior='close-mobile-menu']").trigger("focus");
      mobileMenu.listenForResize();
    });

    $("[data-behavior='close-mobile-menu']").on("click", function(e) {
      e.preventDefault();
      mobileMenu.close();
    });

    // Following an in-page link (for example /#events while on the home page) closes the menu and
    // moves focus to the destination, so keyboard users do not stay on a link inside the hidden menu.
    // Links to other pages navigate normally.
    $menu.on("click", "a[href*='#']", function() {
      var url = new URL(this.href, window.location.href);
      if (url.pathname !== window.location.pathname || url.hash.length < 2) return;
      mobileMenu.close(false);
      var target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      window.setTimeout(function() {
        if (!target.matches("a[href], button, input, select, textarea, [tabindex]")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }, 0);
    });

    $(document).on("keydown", function(e) {
      if (!$menu.hasClass("open")) return;
      if (e.key === "Escape") {
        mobileMenu.close();
        return;
      }
      // The open menu is a modal dialog: keep Tab and Shift+Tab inside it.
      if (e.key === "Tab") {
        var $focusable = $menu.find("a[href], button").filter(":visible");
        var first = $focusable.get(0);
        var last = $focusable.get($focusable.length - 1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  },

  listenForResize: function() {
    $(window).on("resize.ForMobileMenu", function() {
      if ($(this).width() >= 1100) {
        // The desktop menu takes over; move focus out of the hidden dialog to the visible logo link.
        var focusInMenu = $.contains($(".mobile-main-menu")[0], document.activeElement);
        mobileMenu.close(false);
        if (focusInMenu) $(".header-container .header-logo").trigger("focus");
      }
    });
  },

  close: function(returnFocus) {
    $(".mobile-main-menu").removeClass("open");
    $("body").removeClass("no-scroll");
    $(window).off("resize.ForMobileMenu");
    var $open = $("[data-behavior='open-mobile-menu']").attr("aria-expanded", "false");
    if (returnFocus !== false) $open.trigger("focus");
  }
};
