// ده كلاس بسيط بيمثل بيانات العميل
public class Customer {
    private int id;
    private String name;
    private String service;

    // Constructor (عشان تنشئ عميل جديد بسهولة)
    public Customer(int id, String name, String service) {
        this.id = id;
        this.name = name;
        this.service = service;
    }

    // الـ Getters والـ Setters (مهمة عشان مكتبة الـ JSON تعرف تقرأ البيانات)
    public int getId() { return id; }
    public String getName() { return name; }
    public String getService() { return service; }
}
