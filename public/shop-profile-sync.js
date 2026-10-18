(() => {
  try {
    if (typeof LOCAL_PROFILES_DATA !== 'undefined' && !LOCAL_PROFILES_DATA.profiles.butchery) {
      const retail = LOCAL_PROFILES_DATA.profiles.retail;
      LOCAL_PROFILES_DATA.profiles.butchery = {
        ...retail,
        id: 'butchery',
        name: 'Butchery',
        tagline: 'Fresh Meat & Butchery POS',
        icon: '🥩',
        item_label: 'Products',
        capabilities: {
          ...(retail.capabilities || {}),
          decimal_qty: true,
          units_extended: true,
          stock_tracking: true,
        },
      };
    }
    if (typeof SHOP_PROFILES !== 'undefined' && Array.isArray(SHOP_PROFILES) && !SHOP_PROFILES.some(p => p.id === 'butchery')) {
      SHOP_PROFILES.push({ id:'butchery', name:'Butchery', icon:'🥩', tagline:'Fresh Meat & Butchery POS' });
    }
  } catch (err) {
    console.warn('Could not add butchery profile compatibility', err);
  }
})();
