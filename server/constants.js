'use strict';

const VALID_STATUS = ['pending', 'confirmed', 'arrived', 'cancelled', 'no-show'];
const VALID_OCCASIONS = ['', 'Birthday', 'Anniversary', 'Date Night', 'Business', 'Family Gathering', 'Other'];
const VALID_TABLES = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
const VALID_REVIEW_STATUS = ['pending', 'published', 'hidden'];

const POINTS_PER_COVER = 100;
const POINTS_UNIT = 100;
const POINTS_RATE = 0.5;
const SEAT_CAPACITY = 48;
const TIME_SLOTS = [
  '11:00', '11:30', '12:00', '12:30', '13:00',
  '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00'
];

module.exports = {
  VALID_STATUS,
  VALID_OCCASIONS,
  VALID_TABLES,
  VALID_REVIEW_STATUS,
  POINTS_PER_COVER,
  POINTS_UNIT,
  POINTS_RATE,
  SEAT_CAPACITY,
  TIME_SLOTS
};
