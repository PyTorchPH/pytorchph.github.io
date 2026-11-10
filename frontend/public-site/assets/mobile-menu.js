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

    // Following an in-page link (for example /#events while on the home page) closes the menu.
    $menu.on("click", "a[href*='#']", function() {
      mobileMenu.close(false);
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
        mobileMenu.close(false);
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
