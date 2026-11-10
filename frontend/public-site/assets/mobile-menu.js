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
      if (e.key === "Escape" && $menu.hasClass("open")) mobileMenu.close();
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
