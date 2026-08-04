'use strict';

const categories = [
  { id: 1, name: 'Starters', slug: 'starters' },
  { id: 2, name: 'Mains', slug: 'mains' },
  { id: 3, name: 'Grills & Seafood', slug: 'grills-seafood' },
  { id: 4, name: 'Desserts', slug: 'desserts' },
  { id: 5, name: 'Drinks', slug: 'drinks' }
];

const rows = [
  ['Fish Amok Bites','Steamed fish mousse in coconut curry, served in banana-leaf cups with jasmine rice.',8.5,'amok.jpg','Chef’s Pick',1,'starters'],
  ['Fresh Summer Rolls','Rice-paper rolls of prawn, herbs and vermicelli with peanut-lime dip.',6.5,'summer-rolls.jpg','Veg Option',0,'starters'],
  ['Nom Banh Chok Salad','Khmer rice noodles tossed with lemongrass, fish sauce and garden herbs.',7,'noodle-salad.jpg',null,0,'starters'],
  ['Crispy Prawn Skewers','Five-spice prawns on sugarcane, charred and served with tamarind glaze.',10.5,'prawn-skewers.jpg','New',0,'starters'],
  ['Tom Yum Soup','Hot-and-sour prawn soup with lemongrass, lime leaf and button mushrooms.',7.5,'tom-yum.jpg','Spicy',0,'starters'],
  ['Khmer Beef Lok Lak','Wok-seared beef in Kampot-pepper sauce, fresh lime, cucumber and fried egg.',14,'lok-lak.jpg','Signature',1,'mains'],
  ['Grilled Lemongrass Chicken','Free-range chicken marinated overnight in lemongrass, turmeric and kaffir lime.',12.5,'lemongrass-chicken.jpg',null,0,'mains'],
  ['Char Kway Teow','Flat rice noodles, prawns and egg, wok-fried over open flame.',11,'char-kway-teow.jpg',null,0,'mains'],
  ['Nasi Goreng SbyNham','House fried rice with sunny egg, prawn crackers and sambal on the side.',10.5,'nasi-goreng.jpg',null,0,'mains'],
  ['Pumpkin Coconut Curry','Slow-cooked pumpkin and chickpeas in coconut cream with Thai basil.',11.5,'pumpkin-curry.jpg','Veg',0,'mains'],
  ['Seafood Hotpot','Mussels, prawns and fish in a saffron-lime broth for two.',18,'seafood-hotpot.jpg','For Two',1,'mains'],
  ['SbyNham Smash Burger','Double smashed beef, smoked gouda, caramelised onion and house sauce.',13,'smash-burger.jpg',null,0,'mains'],
  ['Whole Grilled Sea Bass','Fire-grilled sea bass with garlic butter and a squeeze of lime.',19,'sea-bass.jpg','Chef’s Pick',1,'grills-seafood'],
  ['BBQ Pork Ribs','Low-and-slow ribs lacquered in our honey-tamarind barbecue glaze.',16.5,'bbq-ribs.jpg',null,0,'grills-seafood'],
  ['Satay Platter','Chicken, beef and prawn satay with peanut sauce and cucumber relish.',14,'satay.jpg',null,0,'grills-seafood'],
  ['Grilled Octopus','Charred octopus tentacle, smoked paprika oil and lemon aioli.',17,'octopus.jpg',null,0,'grills-seafood'],
  ['Sticky Rice & Mango','Warm glutinous rice, ripe mango and coconut cream.',6,'mango-sticky-rice.jpg','Classic',1,'desserts'],
  ['Coconut Pandan Cake','Steamed sponge with coconut cream and pandan custard.',5.5,'pandan-cake.jpg','Veg',0,'desserts'],
  ['Banana Fritters','Golden fritters with honeycomb drizzle and vanilla ice cream.',5,'banana-fritters.jpg',null,0,'desserts'],
  ['Churros & Chocolate','Cinnamon-sugar churros with warm dark chocolate dip.',6.5,'churros.jpg',null,0,'desserts'],
  ['Fresh Young Coconut','Chilled and served whole with a straw. Refill, of course.',3.5,'coconut.jpg',null,0,'drinks'],
  ['Iced Thai Tea','Sweet Thai tea over ice with a cloud of evaporated milk.',3,'thai-tea.jpg',null,0,'drinks'],
  ['Mango Smoothie','Blended Alphonso mango, lime and yogurt.',4.5,'mango-smoothie.jpg','Veg',0,'drinks'],
  ['House Sangria','Red wine, rum-soaked fruit and a splash of soda.',6,'sangria.jpg',null,0,'drinks'],
  ['Local Craft Beer','Pilsner from the Siem Reap brewery on tap. 330ml.',4,'craft-beer.jpg',null,0,'drinks']
];

const menu = rows.map(([name, description, price, image, tag, featured, category_slug], index) => {
  const category = categories.find((item) => item.slug === category_slug);
  return { id: index + 1, name, description, price, image, tag, featured: Boolean(featured), category: category.name, category_slug };
});

module.exports = { categories, menu };
