'use strict';

const categories = [
  { id: 1, name: 'Starters', slug: 'starters' },
  { id: 2, name: 'Mains', slug: 'mains' },
  { id: 3, name: 'Grills & Seafood', slug: 'grills-seafood' },
  { id: 4, name: 'Desserts', slug: 'desserts' },
  { id: 5, name: 'Drinks', slug: 'drinks' }
];

const rows = [
  ['Fish Amok Bites','Steamed fish mousse in coconut curry, served in banana-leaf cups with jasmine rice.',8.5,'amok.svg','Chef’s Pick',1,'starters'],
  ['Fresh Summer Rolls','Rice-paper rolls of prawn, herbs and vermicelli with peanut-lime dip.',6.5,'salad.svg','Veg Option',0,'starters'],
  ['Nom Banh Chok Salad','Khmer rice noodles tossed with lemongrass, fish sauce and garden herbs.',7,'noodles.svg',null,0,'starters'],
  ['Crispy Prawn Skewers','Five-spice prawns on sugarcane, charred and served with tamarind glaze.',10.5,'skewers.svg','New',0,'starters'],
  ['Tom Yum Soup','Hot-and-sour prawn soup with lemongrass, lime leaf and button mushrooms.',7.5,'curry.svg','Spicy',0,'starters'],
  ['Khmer Beef Lok Lak','Wok-seared beef in Kampot-pepper sauce, fresh lime, cucumber and fried egg.',14,'curry.svg','Signature',1,'mains'],
  ['Grilled Lemongrass Chicken','Free-range chicken marinated overnight in lemongrass, turmeric and kaffir lime.',12.5,'skewers.svg',null,0,'mains'],
  ['Char Kway Teow','Flat rice noodles, prawns and egg, wok-fried over open flame.',11,'noodles.svg',null,0,'mains'],
  ['Nasi Goreng SbyNham','House fried rice with sunny egg, prawn crackers and sambal on the side.',10.5,'curry.svg',null,0,'mains'],
  ['Pumpkin Coconut Curry','Slow-cooked pumpkin and chickpeas in coconut cream with Thai basil.',11.5,'curry.svg','Veg',0,'mains'],
  ['Seafood Hotpot','Mussels, prawns and fish in a saffron-lime broth for two.',18,'seafood.svg','For Two',1,'mains'],
  ['SbyNham Smash Burger','Double smashed beef, smoked gouda, caramelised onion and house sauce.',13,'burger.svg',null,0,'mains'],
  ['Whole Grilled Sea Bass','Fire-grilled sea bass with garlic butter and a squeeze of lime.',19,'seafood.svg','Chef’s Pick',1,'grills-seafood'],
  ['BBQ Pork Ribs','Low-and-slow ribs lacquered in our honey-tamarind barbecue glaze.',16.5,'skewers.svg',null,0,'grills-seafood'],
  ['Satay Platter','Chicken, beef and prawn satay with peanut sauce and cucumber relish.',14,'skewers.svg',null,0,'grills-seafood'],
  ['Grilled Octopus','Charred octopus tentacle, smoked paprika oil and lemon aioli.',17,'seafood.svg',null,0,'grills-seafood'],
  ['Sticky Rice & Mango','Warm glutinous rice, ripe mango and coconut cream.',6,'dessert.svg','Classic',1,'desserts'],
  ['Coconut Pandan Cake','Steamed sponge with coconut cream and pandan custard.',5.5,'dessert.svg','Veg',0,'desserts'],
  ['Banana Fritters','Golden fritters with honeycomb drizzle and vanilla ice cream.',5,'dessert.svg',null,0,'desserts'],
  ['Churros & Chocolate','Cinnamon-sugar churros with warm dark chocolate dip.',6.5,'dessert.svg',null,0,'desserts'],
  ['Fresh Young Coconut','Chilled and served whole with a straw. Refill, of course.',3.5,'drink.svg',null,0,'drinks'],
  ['Iced Thai Tea','Sweet Thai tea over ice with a cloud of evaporated milk.',3,'coffee.svg',null,0,'drinks'],
  ['Mango Smoothie','Blended Alphonso mango, lime and yogurt.',4.5,'drink.svg','Veg',0,'drinks'],
  ['House Sangria','Red wine, rum-soaked fruit and a splash of soda.',6,'drink.svg',null,0,'drinks'],
  ['Local Craft Beer','Pilsner from the Siem Reap brewery on tap. 330ml.',4,'drink.svg',null,0,'drinks']
];

const menu = rows.map(([name, description, price, image, tag, featured, category_slug], index) => {
  const category = categories.find((item) => item.slug === category_slug);
  return { id: index + 1, name, description, price, image, tag, featured: Boolean(featured), category: category.name, category_slug };
});

module.exports = { categories, menu };
