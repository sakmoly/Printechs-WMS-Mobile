import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { TopBrandsChart } from "../TopBrandsChart";
import { TopCustomersChart } from "../TopCustomersChart";

export const PerformanceTab: React.FC = () => {
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Top 10 Brands Chart */}
      <TopBrandsChart
        data={[
          {
            brand: "Hitachi",
            total_sales: 12347069.76,
            total_quantity: 50921,
            total_cost: 6536147.69,
            gross_profit_amount: 5810922.07,
            gross_profit_percent: 47.06,
            invoice_count: 1860,
          },
          {
            brand: "Nedap",
            total_sales: 2765682.87,
            total_quantity: 106478,
            total_cost: 2000739.06,
            gross_profit_amount: 764943.81,
            gross_profit_percent: 27.66,
            invoice_count: 132,
          },
          {
            brand: "OTHERS",
            total_sales: 2316183.45,
            total_quantity: 41098,
            total_cost: 3155390.61,
            gross_profit_amount: -839207.16,
            gross_profit_percent: -36.23,
            invoice_count: 224,
          },
          {
            brand: "DATALOGIC",
            total_sales: 2197030.48,
            total_quantity: 3755,
            total_cost: 1484228.22,
            gross_profit_amount: 712802.26,
            gross_profit_percent: 32.44,
            invoice_count: 181,
          },
          {
            brand: "Zebra",
            total_sales: 1986124.25,
            total_quantity: 8112,
            total_cost: 1491031.8,
            gross_profit_amount: 495092.45,
            gross_profit_percent: 24.93,
            invoice_count: 171,
          },
          {
            brand: "AVERY BERKEL",
            total_sales: 1930637.92,
            total_quantity: 757,
            total_cost: 1591002.9,
            gross_profit_amount: 339635.02,
            gross_profit_percent: 17.59,
            invoice_count: 80,
          },
          {
            brand: "FEC POS",
            total_sales: 1305460.0,
            total_quantity: 638,
            total_cost: 1017205.96,
            gross_profit_amount: 288254.04,
            gross_profit_percent: 22.08,
            invoice_count: 66,
          },
          {
            brand: "ANSER",
            total_sales: 874849.43,
            total_quantity: 2811,
            total_cost: 429839.94,
            gross_profit_amount: 445009.49,
            gross_profit_percent: 50.87,
            invoice_count: 130,
          },
          {
            brand: "EPSON",
            total_sales: 657830.0,
            total_quantity: 744,
            total_cost: 589833.27,
            gross_profit_amount: 67996.73,
            gross_profit_percent: 10.34,
            invoice_count: 11,
          },
          {
            brand: "SES-imagotag",
            total_sales: 515796.98,
            total_quantity: 25456,
            total_cost: 413487.63,
            gross_profit_amount: 102309.35,
            gross_profit_percent: 19.84,
            invoice_count: 8,
          },
        ]}
        title="Top 10 Brands"
      />

      {/* Top 10 Customers Chart */}
      <TopCustomersChart
        data={[
          {
            customer: "LANDMARK ARABIA CO.",
            customer_name: "LANDMARK ARABIA CO.",
            total_sales: 357840.0,
            invoice_count: 8,
          },
          {
            customer: "Lulu Saudi Hypermarkets LLC.",
            customer_name: "Lulu Saudi Hypermarkets LLC.",
            total_sales: 191722.0,
            invoice_count: 7,
          },
          {
            customer: "Jazirat SMaa Fashion Co. Ltd.",
            customer_name: "Jazirat SMaa Fashion Co. Ltd.",
            total_sales: 180102.5,
            invoice_count: 27,
          },
          {
            customer: "Hail Agricultural Development Company",
            customer_name: "Hail Agricultural Development Company",
            total_sales: 178100.0,
            invoice_count: 2,
          },
          {
            customer: "SIG COMBIBLOC OBEIKAN COMPANY LTD.",
            customer_name: "SIG COMBIBLOC OBEIKAN COMPANY LTD.",
            total_sales: 57720.0,
            invoice_count: 1,
          },
          {
            customer: "Laziz Dates Factory",
            customer_name: "Laziz Dates Factory",
            total_sales: 47400.0,
            invoice_count: 2,
          },
          {
            customer: "Ansr Al Jazeera Trading Est",
            customer_name: "Ansr Al Jazeera Trading Est",
            total_sales: 38000.0,
            invoice_count: 1,
          },
          {
            customer: "Pinehill Arabia Food Ltd Dammam.",
            customer_name: "Pinehill Arabia Food Ltd Dammam.",
            total_sales: 34290.0,
            invoice_count: 1,
          },
          {
            customer: "Atyab Al Bawadi Dates Factory",
            customer_name: "Atyab Al Bawadi Dates Factory",
            total_sales: 28784.0,
            invoice_count: 3,
          },
          {
            customer: "SD Middle East Branch",
            customer_name: "SD Middle East Branch",
            total_sales: 28329.0,
            invoice_count: 1,
          },
        ]}
        title="Top 10 Customers"
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f8fafc",
  },
});
